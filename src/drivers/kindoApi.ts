import { xs } from 'sygnal'
import type { Stream } from 'sygnal'

// Use Vite proxy in dev to avoid CORS; direct URL in production
const API_BASE = import.meta.env.DEV ? '/api/kindo' : 'https://api.kindo.ai/v1'
const STORAGE_KEY_PREFIX = 'kindo-tracker'

// How many of the most-recent agents to fetch full details for
const DETAIL_FETCH_LIMIT = 30

export type AgentSummary = {
  agentId: string
  name: string
  description: string
  createdAt: string
  creatorName: string
  metadata?: { userPermissions: string[] }
}

export type Agent = AgentSummary & {
  lastRunAtUtc: string | null
  modelsInUse: string[]
  recentRunIds: string[]
  hasTriggers: boolean
  inputs: string[]
}

export type Run = {
  runId: string
  agentId: string | null
  createdAtUtc: string
  endedAtUtc: string | null
  result: string | null
  status: 'in_progress' | 'success' | 'failure' | 'cancelled'
}

export type KindoCommand =
  | { action: 'start'; apiKey: string }
  | { action: 'stop' }
  | { action: 'poll' }

export type KindoResponse = {
  agents: Agent[]
  runs: Record<string, Run>
  totalAgents: number
  fetchedAt: string
  hasActiveRuns: boolean
  error?: string
}

async function fetchJson(url: string, apiKey: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

async function fetchAllData(apiKey: string): Promise<KindoResponse> {
  // 1. Get the agent list — response shape: { items: AgentSummary[], total: number }
  const listData = await fetchJson(`${API_BASE}/agents/list`, apiKey)
  const allSummaries: AgentSummary[] = listData.items || []
  const totalAgents = listData.total || allSummaries.length

  // 2. Sort by createdAt descending and take top N for detail fetching
  const sorted = [...allSummaries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const toFetchDetail = sorted.slice(0, DETAIL_FETCH_LIMIT)

  // 3. Fetch full details for recent agents (includes recentRunIds)
  const agents: Agent[] = await Promise.all(
    toFetchDetail.map(async (summary) => {
      try {
        const detail = await fetchJson(`${API_BASE}/agents/${summary.agentId}`, apiKey)
        return detail as Agent
      } catch {
        return {
          ...summary,
          lastRunAtUtc: null,
          modelsInUse: [],
          recentRunIds: [],
          hasTriggers: false,
          inputs: [],
        } as Agent
      }
    })
  )

  // 4. Collect all run IDs and fetch run details
  const allRunIds = new Set<string>()
  for (const agent of agents) {
    if (agent.recentRunIds) {
      for (const id of agent.recentRunIds) {
        allRunIds.add(id)
      }
    }
  }

  const runs: Record<string, Run> = {}
  // Fetch runs in batches of 10 to avoid overwhelming the API
  const runIdArray = Array.from(allRunIds)
  const BATCH_SIZE = 10
  for (let i = 0; i < runIdArray.length; i += BATCH_SIZE) {
    const batch = runIdArray.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (runId) => {
        try {
          const run = await fetchJson(`${API_BASE}/runs/${runId}`, apiKey)
          runs[runId] = run
        } catch {
          // skip failed run fetches
        }
      })
    )
  }

  const hasActiveRuns = Object.values(runs).some(r => r.status === 'in_progress')
  const fetchedAt = new Date().toISOString()

  // Filter to only agents that have recent runs (so the dashboard is useful)
  // Then add any agents with active runs that might not be in the filtered set
  const agentsWithRuns = agents.filter(a => a.recentRunIds && a.recentRunIds.length > 0)
  const agentsWithoutRuns = agents.filter(a => !a.recentRunIds || a.recentRunIds.length === 0)

  // Show agents with runs first, then those without (limited)
  const displayAgents = [...agentsWithRuns, ...agentsWithoutRuns.slice(0, 5)]

  // Persist for offline use
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-agents`, JSON.stringify(displayAgents))
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-runs`, JSON.stringify(runs))
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-fetchedAt`, fetchedAt)
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-totalAgents`, String(totalAgents))
  } catch {
    // localStorage may be full or unavailable
  }

  return { agents: displayAgents, runs, totalAgents, fetchedAt, hasActiveRuns }
}

export function loadCachedData(): {
  agents: Agent[]
  runs: Record<string, Run>
  fetchedAt: string | null
  totalAgents: number
} {
  try {
    const agents = JSON.parse(localStorage.getItem(`${STORAGE_KEY_PREFIX}-agents`) || '[]')
    const runs = JSON.parse(localStorage.getItem(`${STORAGE_KEY_PREFIX}-runs`) || '{}')
    const fetchedAt = localStorage.getItem(`${STORAGE_KEY_PREFIX}-fetchedAt`)
    const totalAgents = parseInt(localStorage.getItem(`${STORAGE_KEY_PREFIX}-totalAgents`) || '0', 10)
    return { agents, runs, fetchedAt, totalAgents }
  } catch {
    return { agents: [], runs: {}, fetchedAt: null, totalAgents: 0 }
  }
}

export function loadApiKey(): string {
  return localStorage.getItem(`${STORAGE_KEY_PREFIX}-apiKey`) || ''
}

export function saveApiKey(key: string): void {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}-apiKey`, key)
}

export function clearApiKey(): void {
  localStorage.removeItem(`${STORAGE_KEY_PREFIX}-apiKey`)
}

const SLOW_INTERVAL = 60_000
const FAST_INTERVAL = 10_000

export function makeKindoDriver() {
  return function kindoDriver(sink$: Stream<KindoCommand>) {
    let apiKey: string | null = null
    let timerId: ReturnType<typeof setInterval> | null = null
    let currentInterval = SLOW_INTERVAL
    let sendFn: ((data: KindoResponse) => void) | null = null

    async function doPoll() {
      if (!apiKey || !sendFn) return
      try {
        const data = await fetchAllData(apiKey)
        const newInterval = data.hasActiveRuns ? FAST_INTERVAL : SLOW_INTERVAL
        if (newInterval !== currentInterval) {
          currentInterval = newInterval
          if (timerId) {
            clearInterval(timerId)
            timerId = setInterval(doPoll, currentInterval)
          }
        }
        sendFn(data)
      } catch (err: any) {
        sendFn?.({
          agents: [],
          runs: {},
          totalAgents: 0,
          fetchedAt: new Date().toISOString(),
          hasActiveRuns: false,
          error: err.message || 'Failed to fetch',
        })
      }
    }

    function startPolling(key: string) {
      stopPolling()
      apiKey = key
      currentInterval = SLOW_INTERVAL
      doPoll()
      timerId = setInterval(doPoll, currentInterval)
    }

    function stopPolling() {
      if (timerId) {
        clearInterval(timerId)
        timerId = null
      }
      apiKey = null
    }

    sink$.addListener({
      next: (cmd) => {
        switch (cmd.action) {
          case 'start':
            startPolling(cmd.apiKey)
            break
          case 'stop':
            stopPolling()
            break
          case 'poll':
            doPoll()
            break
        }
      },
      error: () => {},
      complete: () => stopPolling(),
    })

    return {
      select: (category: string) => {
        return xs.create<KindoResponse>({
          start: (listener) => {
            sendFn = (data) => listener.next(data)
          },
          stop: () => {
            sendFn = null
          },
        })
      },
    }
  }
}
