import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'kindo-tracker.db')

/** Whether auth is enabled (env vars are set). */
export function isAuthEnabled(): boolean {
  return !!(process.env.KINDO_UN && process.env.KINDO_PW)
}

/** Hash of the configured credentials. Changes when env vars change. */
function getCredentialHash(): string {
  const un = process.env.KINDO_UN || ''
  const pw = process.env.KINDO_PW || ''
  return createHash('sha256').update(`${un}:${pw}`).digest('hex')
}

/** Verify username and password against env vars. */
export function verifyCredentials(username: string, password: string): boolean {
  return username === process.env.KINDO_UN && password === process.env.KINDO_PW
}

/** Create a new session and return the session ID. */
export function createSession(): string {
  const sessionId = randomUUID()
  const credHash = getCredentialHash()
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      credentialHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `)
  db.prepare('INSERT INTO sessions (id, credentialHash, createdAt) VALUES (?, ?, ?)').run(
    sessionId,
    credHash,
    new Date().toISOString(),
  )
  db.close()
  return sessionId
}

/** Validate a session ID. Returns true if session exists and credential hash matches current config. */
export function validateSession(sessionId: string | undefined | null): boolean {
  if (!sessionId) return false
  const credHash = getCredentialHash()
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      credentialHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `)
  const row = db.prepare('SELECT credentialHash FROM sessions WHERE id = ?').get(sessionId) as
    | { credentialHash: string }
    | undefined
  db.close()
  if (!row) return false
  // Session is valid only if the credential hash still matches
  return row.credentialHash === credHash
}

/** Extract session ID from a cookie header string. */
export function extractSessionFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/(?:^|;\s*)kindo_session=([^;]+)/)
  return match ? match[1] : null
}

/** Extract session ID from an HTTP request (cookie header). */
export function getSessionFromRequest(req: IncomingMessage): string | null {
  return extractSessionFromCookie(req.headers.cookie)
}

/** Clean up sessions with stale credential hashes. */
export function cleanStaleSessions() {
  const credHash = getCredentialHash()
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      credentialHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `)
  db.prepare('DELETE FROM sessions WHERE credentialHash != ?').run(credHash)
  db.close()
}
