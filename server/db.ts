import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '..', 'data', 'kindo-tracker.db')

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
): { resolved: Record<string, string>; overriddenKeys: string[] } {
  const serverAll = getAllSettings()
  const resolved: Record<string, string> = {}
  const overriddenKeys: string[] = []

  // Build a map of client entries for quick lookup
  const clientMap = new Map<string, ClientSettingsEntry>()
  for (const entry of clientEntries) {
    clientMap.set(entry.key, entry)
  }

  // Process each known settings key
  for (const key of SETTINGS_KEYS) {
    const clientEntry = clientMap.get(key)
    const serverEntry = serverAll[key]

    if (clientEntry && !serverEntry) {
      // Key exists on client but not server → insert from client
      setSetting(key, clientEntry.value, clientEntry.updatedAt)
      resolved[key] = clientEntry.value
    } else if (!clientEntry && serverEntry) {
      // Key exists on server but not client → keep server
      resolved[key] = serverEntry.value
    } else if (clientEntry && serverEntry) {
      // Both exist → compare timestamps
      const clientTime = new Date(clientEntry.updatedAt).getTime()
      const serverTime = new Date(serverEntry.updatedAt).getTime()

      if (clientTime > serverTime) {
        // Client is newer → update server
        setSetting(key, clientEntry.value, clientEntry.updatedAt)
        resolved[key] = clientEntry.value
      } else if (clientTime < serverTime) {
        // Server is newer → keep server, mark as overridden
        resolved[key] = serverEntry.value
        overriddenKeys.push(key)
      } else {
        // Same timestamp → values should be identical, use server
        resolved[key] = serverEntry.value
      }
    }
    // If neither exists, key won't be in resolved (use defaults)
  }

  return { resolved, overriddenKeys }
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
