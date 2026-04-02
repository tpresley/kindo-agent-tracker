/**
 * localStorage helpers for settings persistence.
 * Pure stateless utility functions — no WS management, no event bridge.
 */
import type { Webhook, AgentWebhookMap, WebhookFireLog } from '../server/types.js'

const STORAGE_PREFIX = 'kindo-tracker'
const TS_PREFIX = `${STORAGE_PREFIX}-ts-`

// ── Timestamp tracking ─────────────────────────────────────

/** Record the current time as the updatedAt for a settings key. */
export function touchTimestamp(key: string) {
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

// ── Settings load/save ─────────────────────────────────────

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
