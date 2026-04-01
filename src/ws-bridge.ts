/**
 * Module-scope WebSocket bridge.
 *
 * Manages the WS connection and bridges server messages into Sygnal's
 * reactive cycle. The Wrapper's intent creates a stream from callbacks
 * registered here; pages call the exported functions via EFFECT sinks.
 */
import type { WsClientMessage, WsServerMessage, Webhook, AgentWebhookMap, WebhookFireLog, SettingsSyncPayload } from '../server/types.js'

// ── Event bridge (simple callback, no xstream dependency) ──
type BridgeCallback = (type: string, data?: any) => void
let _listener: BridgeCallback | null = null

export function setBridgeListener(cb: BridgeCallback) {
  _listener = cb
}

function emit(type: string, data?: any) {
  _listener?.(type, data)
}

// ── WebSocket management ───────────────────────────────────

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
const MAX_RECONNECT_DELAY = 30_000

let lastApiKey: string | null = null
let lastSelectedIds: string[] = []

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const isDev = import.meta.env.DEV
  const host = isDev ? `${location.hostname}:3001` : location.host
  return `${proto}//${host}/ws`
}

/** Build configure message with all settings + timestamps for sync. */
function buildConfigureMsg(apiKey: string, selectedAgentIds: string[]): WsClientMessage {
  return {
    type: 'configure',
    apiKey,
    selectedAgentIds,
    webhooks: loadWebhooks(),
    agentWebhookMap: loadAgentWebhookMap(),
    defaultWebhookId: loadDefaultWebhookId(),
    timestamps: loadTimestamps(),
  }
}

export function connectWs(apiKey: string, selectedAgentIds: string[]) {
  lastApiKey = apiKey
  lastSelectedIds = selectedAgentIds
  reconnectAttempt = 0

  if (ws) {
    ws.close()
    ws = null
  }

  ws = new WebSocket(getWsUrl())

  ws.onopen = () => {
    reconnectAttempt = 0
    emit('WS_OPEN')
    sendWs(buildConfigureMsg(apiKey, selectedAgentIds))
    sendWs({ type: 'fetchAgentList' })
  }

  ws.onmessage = (event) => {
    try {
      const msg: WsServerMessage = JSON.parse(event.data)
      // Handle settingsSync by updating localStorage from server authority
      if (msg.type === 'settingsSync') {
        applyServerSettings(msg.settings)
        // Update module-scope vars to match
        lastApiKey = msg.settings.apiKey || null
        lastSelectedIds = msg.settings.selectedAgentIds
      }
      emit('WS_MESSAGE', msg)
    } catch {
      // ignore
    }
  }

  ws.onclose = () => {
    ws = null
    emit('WS_CLOSE')
    scheduleReconnect()
  }

  ws.onerror = () => {}
}

export function disconnectWs() {
  lastApiKey = null
  lastSelectedIds = []
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
}

export function sendWs(msg: WsClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

export function updateSelectedAgents(selectedAgentIds: string[]) {
  lastSelectedIds = selectedAgentIds
  emit('SELECTION_CHANGED', selectedAgentIds)
  if (lastApiKey) {
    sendWs(buildConfigureMsg(lastApiKey, selectedAgentIds))
  }
}

export function updateWebhookConfig() {
  emit('WEBHOOKS_CHANGED')
  if (lastApiKey) {
    sendWs(buildConfigureMsg(lastApiKey, lastSelectedIds))
  }
}

export function testWebhook(webhook: Webhook) {
  sendWs({ type: 'testWebhook', webhook })
}

function scheduleReconnect() {
  if (!lastApiKey) return
  const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY)
  reconnectAttempt++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (lastApiKey) {
      connectWs(lastApiKey, lastSelectedIds)
    }
  }, delay)
}

// ── localStorage helpers ───────────────────────────────────

const STORAGE_PREFIX = 'kindo-tracker'
const TS_PREFIX = `${STORAGE_PREFIX}-ts-` // Timestamp prefix for each settings key

/** Record the current time as the updatedAt for a settings key. */
function touchTimestamp(key: string) {
  localStorage.setItem(`${TS_PREFIX}${key}`, new Date().toISOString())
}

/** Load all settings timestamps. */
export function loadTimestamps(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const result: Record<string, string> = {}
  for (const key of ['apiKey', 'selectedAgentIds', 'webhooks', 'agentWebhookMap', 'defaultWebhookId']) {
    const ts = localStorage.getItem(`${TS_PREFIX}${key}`)
    if (ts) result[key] = ts
  }
  return result
}

/** Apply authoritative settings from server settingsSync to localStorage. */
function applyServerSettings(settings: SettingsSyncPayload) {
  const now = new Date().toISOString()
  if (settings.apiKey !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-apiKey`, settings.apiKey)
    localStorage.setItem(`${TS_PREFIX}apiKey`, now)
  }
  if (settings.selectedAgentIds !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-selectedAgents`, JSON.stringify(settings.selectedAgentIds))
    localStorage.setItem(`${TS_PREFIX}selectedAgentIds`, now)
  }
  if (settings.webhooks !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-webhooks`, JSON.stringify(settings.webhooks))
    localStorage.setItem(`${TS_PREFIX}webhooks`, now)
  }
  if (settings.agentWebhookMap !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-agentWebhookMap`, JSON.stringify(settings.agentWebhookMap))
    localStorage.setItem(`${TS_PREFIX}agentWebhookMap`, now)
  }
  if (settings.defaultWebhookId !== undefined) {
    if (settings.defaultWebhookId) {
      localStorage.setItem(`${STORAGE_PREFIX}-defaultWebhookId`, settings.defaultWebhookId)
    } else {
      localStorage.removeItem(`${STORAGE_PREFIX}-defaultWebhookId`)
    }
    localStorage.setItem(`${TS_PREFIX}defaultWebhookId`, now)
  }
}

// ── Settings load/save with timestamps ─────────────────────

export function loadApiKey(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(`${STORAGE_PREFIX}-apiKey`) || ''
}

export function saveApiKey(key: string) {
  localStorage.setItem(`${STORAGE_PREFIX}-apiKey`, key)
  touchTimestamp('apiKey')
}

export function clearApiKey() {
  localStorage.removeItem(`${STORAGE_PREFIX}-apiKey`)
  touchTimestamp('apiKey')
}

export function loadSelectedAgentIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}-selectedAgents`) || '[]')
  } catch {
    return []
  }
}

export function saveSelectedAgentIds(ids: string[]) {
  localStorage.setItem(`${STORAGE_PREFIX}-selectedAgents`, JSON.stringify(ids))
  touchTimestamp('selectedAgentIds')
}

export function loadWebhooks(): Webhook[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}-webhooks`) || '[]')
  } catch {
    return []
  }
}

export function saveWebhooks(webhooks: Webhook[]) {
  localStorage.setItem(`${STORAGE_PREFIX}-webhooks`, JSON.stringify(webhooks))
  touchTimestamp('webhooks')
}

export function loadAgentWebhookMap(): AgentWebhookMap {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}-agentWebhookMap`) || '{}')
  } catch {
    return {}
  }
}

export function saveAgentWebhookMap(map: AgentWebhookMap) {
  localStorage.setItem(`${STORAGE_PREFIX}-agentWebhookMap`, JSON.stringify(map))
  touchTimestamp('agentWebhookMap')
}

export function loadDefaultWebhookId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(`${STORAGE_PREFIX}-defaultWebhookId`) || null
}

export function saveDefaultWebhookId(id: string | null) {
  if (id) {
    localStorage.setItem(`${STORAGE_PREFIX}-defaultWebhookId`, id)
  } else {
    localStorage.removeItem(`${STORAGE_PREFIX}-defaultWebhookId`)
  }
  touchTimestamp('defaultWebhookId')
}

// ── Cache data (not synced to server) ──────────────────────

export function loadCachedAgents() {
  if (typeof window === 'undefined') return { agents: [], runs: {}, fetchedAt: null }
  try {
    return {
      agents: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}-agents`) || '[]'),
      runs: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}-runs`) || '{}'),
      fetchedAt: localStorage.getItem(`${STORAGE_PREFIX}-fetchedAt`),
    }
  } catch {
    return { agents: [], runs: {}, fetchedAt: null }
  }
}

export function cacheAgentData(agents: any[], runs: Record<string, any>, fetchedAt: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}-agents`, JSON.stringify(agents))
    localStorage.setItem(`${STORAGE_PREFIX}-runs`, JSON.stringify(runs))
    localStorage.setItem(`${STORAGE_PREFIX}-fetchedAt`, fetchedAt)
  } catch {}
}

export function loadWebhookLog(): WebhookFireLog[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}-webhookLog`) || '[]')
  } catch {
    return []
  }
}

export function saveWebhookLog(log: WebhookFireLog[]) {
  localStorage.setItem(`${STORAGE_PREFIX}-webhookLog`, JSON.stringify(log))
}
