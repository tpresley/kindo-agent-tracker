import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { Server as HttpServer } from 'node:http'
import type {
  Agent, Run, Webhook, AgentWebhookMap, WebhookFireLog,
  WsClientMessage, WsServerMessage,
} from './types.js'
import { fetchAgentList, fetchAgentDetails, fetchModelMap } from './kindo.js'
import { isAuthEnabled, validateSession, extractSessionFromCookie } from './auth.js'
import { resolveSettings, setSetting, loadSettingsForClient, getAllSettings, SETTINGS_KEYS } from './db.js'
import type { SettingsSyncPayload } from './types.js'

const SLOW_INTERVAL = 60_000
const FAST_INTERVAL = 10_000

type AgentStatus = 'success' | 'failure' | 'cancelled' | 'in_progress' | 'unknown'

type ClientState = {
  apiKey: string | null
  selectedAgentIds: string[]
  timer: ReturnType<typeof setInterval> | null
  currentInterval: number
  // Webhook config (received from client)
  webhooks: Webhook[]
  agentWebhookMap: AgentWebhookMap
  defaultWebhookId: string | null
  // Transition tracking
  lastKnownStatus: Record<string, AgentStatus>
}

function send(ws: WebSocket, msg: WsServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
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

// ── Webhook resolution ─────────────────────────────────────

function getWebhooksForAgent(client: ClientState, agentId: string): Webhook[] {
  // If agent has explicit assignment in the map, use it
  if (agentId in client.agentWebhookMap) {
    const ids = client.agentWebhookMap[agentId]
    return client.webhooks.filter(w => ids.includes(w.id) && w.enabled)
  }
  // Otherwise fall back to default webhook
  if (client.defaultWebhookId) {
    const def = client.webhooks.find(w => w.id === client.defaultWebhookId && w.enabled)
    return def ? [def] : []
  }
  return []
}

// ── Webhook firing ─────────────────────────────────────────

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

function getMostRecentCompletedRun(agent: Agent, runs: Record<string, Run>): Run | null {
  const completedRuns = (agent.recentRunIds || [])
    .map(id => runs[id])
    .filter(r => r && r.status !== 'in_progress')
    .sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime())
  return completedRuns[0] || null
}

async function fireWebhooksForAgent(
  ws: WebSocket,
  client: ClientState,
  agent: Agent,
  runs: Record<string, Run>,
  transition: 'failure' | 'recovery',
  previousStatus: string,
) {
  let webhooks = getWebhooksForAgent(client, agent.agentId)
  if (transition === 'recovery') {
    webhooks = webhooks.filter(w => w.notifyOnRecovery)
  }
  if (webhooks.length === 0) return

  const latestRun = getMostRecentCompletedRun(agent, runs)
  if (!latestRun) return

  const vars: Record<string, string> = {
    agentId: agent.agentId,
    agentName: agent.name || 'Unknown Agent',
    runId: latestRun.runId,
    status: latestRun.status,
    previousStatus,
    createdAt: latestRun.createdAtUtc,
    endedAt: latestRun.endedAtUtc || '',
    duration: formatDuration(latestRun.createdAtUtc, latestRun.endedAtUtc),
    runResult: (latestRun.result || '').substring(0, 500),
    dashboardUrl: '/',
  }

  for (const webhook of webhooks) {
    const body = resolveTemplate(webhook.bodyTemplate, vars)
    const result = await fireWebhook(webhook, body)
    const log: WebhookFireLog = {
      id: randomUUID(),
      webhookId: webhook.id,
      webhookName: webhook.name,
      agentId: agent.agentId,
      agentName: agent.name || 'Unknown Agent',
      transition,
      previousStatus,
      newStatus: latestRun.status,
      httpStatus: result.httpStatus,
      success: result.success,
      error: result.error,
      timestamp: new Date().toISOString(),
    }
    send(ws, { type: 'webhookFired', log })
  }
}

// ── Transition detection ───────────────────────────────────

async function detectTransitionsAndFire(
  ws: WebSocket,
  client: ClientState,
  agents: Agent[],
  runs: Record<string, Run>,
) {
  if (client.webhooks.length === 0) return

  for (const agent of agents) {
    const latestRun = getMostRecentCompletedRun(agent, runs)
    if (!latestRun) continue

    const currentStatus: AgentStatus = latestRun.status
    const previousStatus = client.lastKnownStatus[agent.agentId]

    if (previousStatus === undefined) {
      // First poll for this agent — establish baseline, don't fire
      client.lastKnownStatus[agent.agentId] = currentStatus
      continue
    }

    if (previousStatus !== 'failure' && currentStatus === 'failure') {
      await fireWebhooksForAgent(ws, client, agent, runs, 'failure', previousStatus)
    } else if (previousStatus === 'failure' && currentStatus === 'success') {
      await fireWebhooksForAgent(ws, client, agent, runs, 'recovery', previousStatus)
    }

    client.lastKnownStatus[agent.agentId] = currentStatus
  }
}

// ── Polling ────────────────────────────────────────────────

async function poll(ws: WebSocket, client: ClientState) {
  if (!client.apiKey || client.selectedAgentIds.length === 0) return

  try {
    const { agents, runs, hasActiveRuns } = await fetchAgentDetails(
      client.apiKey,
      client.selectedAgentIds,
    )

    send(ws, {
      type: 'agentData',
      agents,
      runs,
      totalAgents: client.selectedAgentIds.length,
      fetchedAt: new Date().toISOString(),
      hasActiveRuns,
    })

    // Detect transitions and fire webhooks
    await detectTransitionsAndFire(ws, client, agents, runs)

    // Adapt interval
    const newInterval = hasActiveRuns ? FAST_INTERVAL : SLOW_INTERVAL
    if (newInterval !== client.currentInterval && client.timer) {
      clearInterval(client.timer)
      client.currentInterval = newInterval
      client.timer = setInterval(() => poll(ws, client), client.currentInterval)
    }
  } catch (err: any) {
    send(ws, { type: 'error', message: err.message || 'Poll failed' })
  }
}

function stopPolling(client: ClientState) {
  if (client.timer) {
    clearInterval(client.timer)
    client.timer = null
  }
}

function startPolling(ws: WebSocket, client: ClientState) {
  stopPolling(client)
  if (!client.apiKey || client.selectedAgentIds.length === 0) return
  client.currentInterval = SLOW_INTERVAL
  poll(ws, client)
  client.timer = setInterval(() => poll(ws, client), client.currentInterval)
}

// ── Settings sync helpers ──────────────────────────────────

function buildSettingsSyncPayload(client: ClientState): SettingsSyncPayload {
  return {
    apiKey: client.apiKey || '',
    selectedAgentIds: client.selectedAgentIds,
    webhooks: client.webhooks,
    agentWebhookMap: client.agentWebhookMap,
    defaultWebhookId: client.defaultWebhookId,
  }
}

function applySettingsToClient(client: ClientState, resolved: Record<string, string>) {
  if (resolved.apiKey !== undefined) client.apiKey = resolved.apiKey || null
  if (resolved.selectedAgentIds !== undefined) client.selectedAgentIds = JSON.parse(resolved.selectedAgentIds)
  if (resolved.webhooks !== undefined) client.webhooks = JSON.parse(resolved.webhooks)
  if (resolved.agentWebhookMap !== undefined) client.agentWebhookMap = JSON.parse(resolved.agentWebhookMap)
  if (resolved.defaultWebhookId !== undefined) client.defaultWebhookId = resolved.defaultWebhookId || null
}

function populateClientFromDb(client: ClientState) {
  const db = loadSettingsForClient()
  if (db.apiKey) client.apiKey = db.apiKey
  if (db.selectedAgentIds.length > 0) client.selectedAgentIds = db.selectedAgentIds
  if (db.webhooks.length > 0) client.webhooks = db.webhooks
  if (Object.keys(db.agentWebhookMap).length > 0) client.agentWebhookMap = db.agentWebhookMap
  if (db.defaultWebhookId) client.defaultWebhookId = db.defaultWebhookId
}

// ── Message handling ───────────────────────────────────────

async function handleMessage(ws: WebSocket, client: ClientState, msg: WsClientMessage) {
  switch (msg.type) {
    case 'configure': {
      const prevApiKey = client.apiKey
      const prevIds = new Set(client.selectedAgentIds)

      // Build client entries for conflict resolution.
      // Use epoch 0 for keys without timestamps — this means the client has no
      // authoritative opinion, so the server will win if it has any data.
      // But if the server also has no data, the client value gets inserted.
      const timestamps = msg.timestamps || {}
      const NO_OPINION = '1970-01-01T00:00:00.000Z'
      const clientEntries = [
        { key: 'apiKey', value: msg.apiKey, updatedAt: timestamps.apiKey || NO_OPINION },
        { key: 'selectedAgentIds', value: JSON.stringify(msg.selectedAgentIds), updatedAt: timestamps.selectedAgentIds || NO_OPINION },
        { key: 'webhooks', value: JSON.stringify(msg.webhooks || []), updatedAt: timestamps.webhooks || NO_OPINION },
        { key: 'agentWebhookMap', value: JSON.stringify(msg.agentWebhookMap || {}), updatedAt: timestamps.agentWebhookMap || NO_OPINION },
        { key: 'defaultWebhookId', value: msg.defaultWebhookId ?? '', updatedAt: timestamps.defaultWebhookId || NO_OPINION },
      ]

      // Resolve against SQLite
      const { resolved, resolvedTimestamps, overriddenKeys } = resolveSettings(clientEntries)

      // Apply resolved values to ClientState
      applySettingsToClient(client, resolved)

      // Send authoritative state back to client with server timestamps
      send(ws, {
        type: 'settingsSync',
        settings: buildSettingsSyncPayload(client),
        overriddenKeys,
        timestamps: resolvedTimestamps,
      })

      // Clean up lastKnownStatus for removed agents
      for (const id of Object.keys(client.lastKnownStatus)) {
        if (!client.selectedAgentIds.includes(id)) {
          delete client.lastKnownStatus[id]
        }
      }

      // Restart polling if API key or agents changed, or if not already polling
      const newIds = new Set(client.selectedAgentIds)
      const selectionChanged = prevIds.size !== newIds.size || [...prevIds].some(id => !newIds.has(id))
      if (selectionChanged || client.apiKey !== prevApiKey || !client.timer) {
        startPolling(ws, client)
      }
      break
    }
    case 'refresh': {
      poll(ws, client)
      break
    }
    case 'fetchAgentList': {
      if (!client.apiKey) {
        send(ws, { type: 'error', message: 'No API key configured' })
        return
      }
      try {
        const [{ agents, total }, models] = await Promise.all([
          fetchAgentList(client.apiKey),
          fetchModelMap(client.apiKey),
        ])
        send(ws, { type: 'agentList', agents, total, models })
      } catch (err: any) {
        send(ws, { type: 'error', message: err.message || 'Failed to fetch agent list' })
      }
      break
    }
    case 'testWebhook': {
      const { webhook } = msg
      const sampleVars: Record<string, string> = {
        agentId: 'test-agent-id',
        agentName: 'Test Agent',
        runId: 'test-run-id',
        status: 'failure',
        previousStatus: 'success',
        createdAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        duration: '2m 30s',
        runResult: 'Test webhook fired from Kindo Agent Tracker',
        dashboardUrl: '/',
      }
      const body = resolveTemplate(webhook.bodyTemplate, sampleVars)
      const result = await fireWebhook(webhook, body)
      send(ws, {
        type: 'webhookTestResult',
        webhookId: webhook.id,
        httpStatus: result.httpStatus,
        success: result.success,
        error: result.error,
      })
      break
    }
    case 'getSettings': {
      populateClientFromDb(client)
      const allSettings = getAllSettings()
      const ts: Record<string, string> = {}
      for (const [k, v] of Object.entries(allSettings)) ts[k] = v.updatedAt
      send(ws, {
        type: 'settingsSync',
        settings: buildSettingsSyncPayload(client),
        overriddenKeys: [],
        timestamps: ts,
      })
      break
    }
  }
}

// ── WebSocket server ───────────────────────────────────────

export function attachWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, callback) => {
      if (!isAuthEnabled()) {
        callback(true)
        return
      }
      const sessionId = extractSessionFromCookie(info.req.headers.cookie)
      if (validateSession(sessionId)) {
        callback(true)
      } else {
        callback(false, 401, 'Unauthorized')
      }
    },
  })

  wss.on('connection', (ws) => {
    const client: ClientState = {
      apiKey: null,
      selectedAgentIds: [],
      timer: null,
      currentInterval: SLOW_INTERVAL,
      webhooks: [],
      agentWebhookMap: {},
      defaultWebhookId: null,
      lastKnownStatus: {},
    }

    // Pre-load from SQLite so server has config even before client sends configure
    populateClientFromDb(client)

    ws.on('message', (raw) => {
      try {
        const msg: WsClientMessage = JSON.parse(String(raw))
        handleMessage(ws, client, msg)
      } catch {
        send(ws, { type: 'error', message: 'Invalid message' })
      }
    })

    ws.on('close', () => stopPolling(client))
    ws.on('error', () => stopPolling(client))
  })

  return wss
}
