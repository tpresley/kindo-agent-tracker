/**
 * Singleton polling engine.
 *
 * Runs independently of WebSocket connections — polls the Kindo API,
 * detects status transitions, fires webhooks, and broadcasts results
 * to any connected WS clients.
 */
import { randomUUID } from 'node:crypto'
import type { Agent, Run, Webhook, AgentWebhookMap, WebhookFireLog, WsServerMessage } from './types.js'
import { fetchAgentDetails } from './kindo.js'
import { loadSettingsForClient } from './db.js'

const SLOW_INTERVAL = 60_000
const FAST_INTERVAL = 10_000

type AgentStatus = 'success' | 'failure' | 'cancelled' | 'in_progress' | 'unknown'
type AgentTracker = { status: AgentStatus; runId: string }

// ── Singleton state ────────────────────────────────────────

let apiKey: string | null = null
let selectedAgentIds: string[] = []
let webhooks: Webhook[] = []
let agentWebhookMap: AgentWebhookMap = {}
let defaultWebhookId: string | null = null

let lastKnown: Record<string, AgentTracker> = {}
let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = SLOW_INTERVAL
let lastPollResult: WsServerMessage | null = null

const listeners = new Set<(msg: WsServerMessage) => void>()

// ── Broadcast to connected clients ─────────────────────────

function broadcast(msg: WsServerMessage) {
  if (msg.type === 'agentData') {
    // Cache a lightweight copy for new clients (strip run results to save memory)
    const lightRuns: Record<string, any> = {}
    for (const [id, run] of Object.entries((msg as any).runs)) {
      const { result, ...rest } = run as any
      lightRuns[id] = rest
    }
    lastPollResult = { ...msg, runs: lightRuns } as any
  }
  for (const fn of listeners) {
    try { fn(msg) } catch { /* ignore dead listeners */ }
  }
}

export function registerListener(fn: (msg: WsServerMessage) => void) {
  listeners.add(fn)
  // Send cached poll result immediately so new clients don't wait for next cycle
  if (lastPollResult) {
    try { fn(lastPollResult) } catch { /* ignore */ }
  }
}

export function unregisterListener(fn: (msg: WsServerMessage) => void) {
  listeners.delete(fn)
}

// ── Template resolution ────────────────────────────────────

function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return 'running...'
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

// ── Webhook resolution + firing ────────────────────────────

function getWebhooksForAgent(agentId: string): Webhook[] {
  if (agentId in agentWebhookMap) {
    const ids = agentWebhookMap[agentId]
    return webhooks.filter(w => ids.includes(w.id) && w.enabled)
  }
  if (defaultWebhookId) {
    const def = webhooks.find(w => w.id === defaultWebhookId && w.enabled)
    return def ? [def] : []
  }
  return []
}

async function fireWebhook(webhook: Webhook, body: string): Promise<{ httpStatus: number | null; success: boolean; error?: string }> {
  try {
    const res = await fetch(webhook.url, {
      method: webhook.method,
      headers: { 'Content-Type': 'application/json', ...webhook.headers },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    return { httpStatus: res.status, success: res.ok }
  } catch (err: any) {
    return { httpStatus: null, success: false, error: err.message || 'Request failed' }
  }
}

export async function fireTestWebhook(webhook: Webhook): Promise<{ httpStatus: number | null; success: boolean; error?: string }> {
  const sampleVars: Record<string, string> = {
    agentId: 'test-agent-id', agentName: 'Test Agent', runId: 'test-run-id',
    status: 'failure', previousStatus: 'success',
    createdAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    duration: '2m 30s', runResult: 'Test webhook fired from Kindo Agent Tracker', dashboardUrl: '/',
  }
  const body = resolveTemplate(webhook.bodyTemplate, sampleVars)
  return fireWebhook(webhook, body)
}

function getMostRecentCompletedRun(agent: Agent, runs: Record<string, Run>): Run | null {
  const completedRuns = (agent.recentRunIds || [])
    .map(id => runs[id])
    .filter(r => r && r.status !== 'in_progress')
    .sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime())
  return completedRuns[0] || null
}

async function fireWebhooksForAgent(
  agent: Agent, runs: Record<string, Run>,
  transition: 'failure' | 'recovery', previousStatus: string,
) {
  let whs = getWebhooksForAgent(agent.agentId)
  if (transition === 'recovery') whs = whs.filter(w => w.notifyOnRecovery)
  if (whs.length === 0) return

  const latestRun = getMostRecentCompletedRun(agent, runs)
  if (!latestRun) return

  const vars: Record<string, string> = {
    agentId: agent.agentId, agentName: agent.name || 'Unknown Agent',
    runId: latestRun.runId, status: latestRun.status, previousStatus,
    createdAt: latestRun.createdAtUtc, endedAt: latestRun.endedAtUtc || '',
    duration: formatDuration(latestRun.createdAtUtc, latestRun.endedAtUtc),
    runResult: (latestRun.result || '').substring(0, 500), dashboardUrl: '/',
  }

  for (const wh of whs) {
    const body = resolveTemplate(wh.bodyTemplate, vars)
    const result = await fireWebhook(wh, body)
    const log: WebhookFireLog = {
      id: randomUUID(), webhookId: wh.id, webhookName: wh.name,
      agentId: agent.agentId, agentName: agent.name || 'Unknown Agent',
      transition, previousStatus, newStatus: latestRun.status,
      httpStatus: result.httpStatus, success: result.success, error: result.error,
      timestamp: new Date().toISOString(),
    }
    broadcast({ type: 'webhookFired', log })
  }
}

// ── Transition detection ───────────────────────────────────

async function detectTransitions(agents: Agent[], runs: Record<string, Run>) {
  if (webhooks.length === 0) return

  for (const agent of agents) {
    const latestRun = getMostRecentCompletedRun(agent, runs)
    if (!latestRun) continue

    const currentStatus: AgentStatus = latestRun.status
    const prev = lastKnown[agent.agentId]

    if (!prev) {
      lastKnown[agent.agentId] = { status: currentStatus, runId: latestRun.runId }
      continue
    }

    if (latestRun.runId === prev.runId) continue

    if (prev.status !== 'failure' && currentStatus === 'failure') {
      await fireWebhooksForAgent(agent, runs, 'failure', prev.status)
    } else if (prev.status === 'failure' && currentStatus === 'success') {
      await fireWebhooksForAgent(agent, runs, 'recovery', prev.status)
    }

    lastKnown[agent.agentId] = { status: currentStatus, runId: latestRun.runId }
  }
}

// ── Polling ────────────────────────────────────────────────

async function poll() {
  if (!apiKey || selectedAgentIds.length === 0) return

  try {
    const { agents, runs, hasActiveRuns } = await fetchAgentDetails(apiKey, selectedAgentIds)

    broadcast({
      type: 'agentData', agents, runs,
      totalAgents: selectedAgentIds.length,
      fetchedAt: new Date().toISOString(),
      hasActiveRuns,
    })

    await detectTransitions(agents, runs)

    // Adapt interval
    const newInterval = hasActiveRuns ? FAST_INTERVAL : SLOW_INTERVAL
    if (newInterval !== currentInterval && timer) {
      clearInterval(timer)
      currentInterval = newInterval
      timer = setInterval(poll, currentInterval)
    }
  } catch (err: any) {
    broadcast({ type: 'error', message: err.message || 'Poll failed' })
  }
}

function stopPolling() {
  if (timer) { clearInterval(timer); timer = null }
}

function startPolling() {
  stopPolling()
  if (!apiKey || selectedAgentIds.length === 0) return
  currentInterval = SLOW_INTERVAL
  poll()
  timer = setInterval(poll, currentInterval)
}

// ── Public API ─────────────────────────────────────────────

/** Initialize engine from SQLite. Call once on server start. */
export function initEngine() {
  reloadConfig()
}

/** Broadcast current settings to all connected clients. */
export function broadcastSettings(excludeListener?: (msg: WsServerMessage) => void) {
  const db = loadSettingsForClient()
  const msg: WsServerMessage = {
    type: 'settingsSync',
    settings: {
      apiKey: db.apiKey || '',
      selectedAgentIds: db.selectedAgentIds,
      webhooks: db.webhooks,
      agentWebhookMap: db.agentWebhookMap,
      defaultWebhookId: db.defaultWebhookId,
    },
    overriddenKeys: [],
    timestamps: {},
  }
  for (const fn of listeners) {
    if (fn === excludeListener) continue
    try { fn(msg) } catch { /* ignore */ }
  }
}

/** Re-read settings from SQLite and restart polling if config changed. */
export function reloadConfig() {
  const prev = { apiKey, selectedAgentIds: [...selectedAgentIds] }
  const db = loadSettingsForClient()

  apiKey = db.apiKey
  selectedAgentIds = db.selectedAgentIds
  webhooks = db.webhooks
  agentWebhookMap = db.agentWebhookMap
  defaultWebhookId = db.defaultWebhookId

  // Clean up trackers for removed agents
  for (const id of Object.keys(lastKnown)) {
    if (!selectedAgentIds.includes(id)) delete lastKnown[id]
  }

  // Restart polling if API key or agents changed, or if not already polling
  const selectionChanged = prev.selectedAgentIds.length !== selectedAgentIds.length ||
    prev.selectedAgentIds.some(id => !selectedAgentIds.includes(id))
  if (selectionChanged || prev.apiKey !== apiKey || !timer) {
    startPolling()
  }
}

/** Trigger an immediate poll. */
export function forceRefresh() {
  poll()
}
