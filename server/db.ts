import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { WebhookFireLog } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'kindo-tracker.db')
const WEBHOOK_LOG_LIMIT = 100

let db: Database.Database

export function initDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_fire_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_fire_logs_timestamp ON webhook_fire_logs(timestamp)`)
}

export function getSetting(key: string): { value: string; updatedAt: string } | null {
  const row = db.prepare('SELECT value, updatedAt FROM settings WHERE key = ?').get(key) as
    | { value: string; updatedAt: string }
    | undefined
  return row || null
}

export function getAllSettings(): Record<string, { value: string; updatedAt: string }> {
  const rows = db.prepare('SELECT key, value, updatedAt FROM settings').all() as Array<{
    key: string
    value: string
    updatedAt: string
  }>
  const result: Record<string, { value: string; updatedAt: string }> = {}
  for (const row of rows) {
    result[row.key] = { value: row.value, updatedAt: row.updatedAt }
  }
  return result
}

export function setSetting(key: string, value: string, updatedAt: string) {
  db.prepare(
    'INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt',
  ).run(key, value, updatedAt)
}

/** The five settings keys that are synced. */
export const SETTINGS_KEYS = [
  'apiKey',
  'selectedAgentIds',
  'webhooks',
  'agentWebhookMap',
  'defaultWebhookId',
] as const

export type SettingsKey = (typeof SETTINGS_KEYS)[number]

type ClientSettingsEntry = { key: string; value: string; updatedAt: string }

/**
 * Resolve client settings against server DB.
 * Returns the authoritative resolved values and a list of keys where
 * the server's data was newer (client was overridden).
 */
export function resolveSettings(
  clientEntries: ClientSettingsEntry[],
): { resolved: Record<string, string>; resolvedTimestamps: Record<string, string>; overriddenKeys: string[] } {
  const serverAll = getAllSettings()
  const resolved: Record<string, string> = {}
  const resolvedTimestamps: Record<string, string> = {}
  const overriddenKeys: string[] = []

  const clientMap = new Map<string, ClientSettingsEntry>()
  for (const entry of clientEntries) {
    clientMap.set(entry.key, entry)
  }

  for (const key of SETTINGS_KEYS) {
    const clientEntry = clientMap.get(key)
    const serverEntry = serverAll[key]

    if (clientEntry && !serverEntry) {
      setSetting(key, clientEntry.value, clientEntry.updatedAt)
      resolved[key] = clientEntry.value
      resolvedTimestamps[key] = clientEntry.updatedAt
    } else if (!clientEntry && serverEntry) {
      resolved[key] = serverEntry.value
      resolvedTimestamps[key] = serverEntry.updatedAt
    } else if (clientEntry && serverEntry) {
      const clientTime = new Date(clientEntry.updatedAt).getTime()
      const serverTime = new Date(serverEntry.updatedAt).getTime()

      if (clientTime > serverTime) {
        setSetting(key, clientEntry.value, clientEntry.updatedAt)
        resolved[key] = clientEntry.value
        resolvedTimestamps[key] = clientEntry.updatedAt
      } else if (clientTime < serverTime) {
        resolved[key] = serverEntry.value
        resolvedTimestamps[key] = serverEntry.updatedAt
        overriddenKeys.push(key)
      } else {
        resolved[key] = serverEntry.value
        resolvedTimestamps[key] = serverEntry.updatedAt
      }
    }
  }

  return { resolved, resolvedTimestamps, overriddenKeys }
}

// ── Webhook fire logs ──────────────────────────────────────

/**
 * Persist a webhook fire log and prune to the most recent WEBHOOK_LOG_LIMIT entries.
 */
export function appendWebhookLog(log: WebhookFireLog) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO webhook_fire_logs (id, timestamp, payload) VALUES (?, ?, ?)',
  )
  const prune = db.prepare(`
    DELETE FROM webhook_fire_logs
    WHERE id NOT IN (
      SELECT id FROM webhook_fire_logs ORDER BY timestamp DESC LIMIT ?
    )
  `)
  const tx = db.transaction(() => {
    insert.run(log.id, log.timestamp, JSON.stringify(log))
    prune.run(WEBHOOK_LOG_LIMIT)
  })
  tx()
}

/**
 * Load all persisted webhook fire logs, oldest first (client appends newest to the end).
 */
export function loadWebhookLogs(): WebhookFireLog[] {
  const rows = db.prepare(
    'SELECT payload FROM webhook_fire_logs ORDER BY timestamp ASC',
  ).all() as Array<{ payload: string }>
  const out: WebhookFireLog[] = []
  for (const row of rows) {
    try { out.push(JSON.parse(row.payload)) } catch { /* skip bad row */ }
  }
  return out
}

/**
 * Load settings into a shape suitable for populating ClientState.
 */
export function loadSettingsForClient(): {
  apiKey: string | null
  selectedAgentIds: string[]
  webhooks: any[]
  agentWebhookMap: Record<string, string[]>
  defaultWebhookId: string | null
} {
  const all = getAllSettings()
  return {
    apiKey: all.apiKey ? all.apiKey.value : null,
    selectedAgentIds: all.selectedAgentIds ? JSON.parse(all.selectedAgentIds.value) : [],
    webhooks: all.webhooks ? JSON.parse(all.webhooks.value) : [],
    agentWebhookMap: all.agentWebhookMap ? JSON.parse(all.agentWebhookMap.value) : {},
    defaultWebhookId: all.defaultWebhookId ? all.defaultWebhookId.value || null : null,
  }
}
