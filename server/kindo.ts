import type { AgentSummary, Agent, Run, ModelInfo } from './types.js'

const API_BASE = 'https://api.kindo.ai/v1'

async function fetchJson(url: string, apiKey: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

/** Fetch the full agent list (summaries only, no run details). */
export async function fetchAgentList(apiKey: string): Promise<{ agents: AgentSummary[]; total: number }> {
  const data = await fetchJson(`${API_BASE}/agents/list`, apiKey)
  return { agents: data.items || [], total: data.total || 0 }
}

/** Fetch model list and return a UUID → display name map. */
export async function fetchModelMap(apiKey: string): Promise<Record<string, string>> {
  try {
    const data = await fetchJson(`${API_BASE}/models`, apiKey)
    const models: ModelInfo[] = data.data || []
    const map: Record<string, string> = {}
    for (const m of models) {
      map[m.id] = m.owned_by ? `${m.owned_by}` : m.id
    }
    return map
  } catch {
    return {}
  }
}

/** Fetch full details + runs for a set of selected agent IDs. */
export async function fetchAgentDetails(
  apiKey: string,
  agentIds: string[],
): Promise<{ agents: Agent[]; runs: Record<string, Run>; hasActiveRuns: boolean }> {
  if (agentIds.length === 0) {
    return { agents: [], runs: {}, hasActiveRuns: false }
  }

  // Fetch agent details in parallel
  const agents: Agent[] = await Promise.all(
    agentIds.map(async (id) => {
      try {
        return await fetchJson(`${API_BASE}/agents/${id}`, apiKey)
      } catch {
        return {
          agentId: id,
          name: 'Unknown',
          description: '',
          createdAt: '',
          creatorName: '',
          lastRunAtUtc: null,
          modelsInUse: [],
          recentRunIds: [],
          hasTriggers: false,
          inputs: [],
        } as Agent
      }
    }),
  )

  // Collect all run IDs
  const allRunIds = new Set<string>()
  for (const agent of agents) {
    if (agent.recentRunIds) {
      for (const id of agent.recentRunIds) {
        allRunIds.add(id)
      }
    }
  }

  // Fetch runs in batches of 10
  const runs: Record<string, Run> = {}
  const runIdArray = Array.from(allRunIds)
  const BATCH_SIZE = 10
  for (let i = 0; i < runIdArray.length; i += BATCH_SIZE) {
    const batch = runIdArray.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (runId) => {
        try {
          runs[runId] = await fetchJson(`${API_BASE}/runs/${runId}`, apiKey)
        } catch {
          // skip
        }
      }),
    )
  }

  const hasActiveRuns = Object.values(runs).some((r) => r.status === 'in_progress')

  return { agents, runs, hasActiveRuns }
}
