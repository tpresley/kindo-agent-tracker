import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'kindo-tracker.db')

// Singleton DB connection — initialized lazily
let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        credentialHash TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )
    `)
  }
  return db
}

export function isAuthEnabled(): boolean {
  return !!(process.env.KINDO_UN && process.env.KINDO_PW)
}

function getCredentialHash(): string {
  const un = process.env.KINDO_UN || ''
  const pw = process.env.KINDO_PW || ''
  return createHash('sha256').update(`${un}:${pw}`).digest('hex')
}

export function verifyCredentials(username: string, password: string): boolean {
  return username === process.env.KINDO_UN && password === process.env.KINDO_PW
}

export function createSession(): string {
  const sessionId = randomUUID()
  getDb().prepare('INSERT INTO sessions (id, credentialHash, createdAt) VALUES (?, ?, ?)').run(
    sessionId, getCredentialHash(), new Date().toISOString(),
  )
  return sessionId
}

export function validateSession(sessionId: string | undefined | null): boolean {
  if (!sessionId) return false
  const row = getDb().prepare('SELECT credentialHash FROM sessions WHERE id = ?').get(sessionId) as
    | { credentialHash: string }
    | undefined
  if (!row) return false
  return row.credentialHash === getCredentialHash()
}

export function extractSessionFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/(?:^|;\s*)kindo_session=([^;]+)/)
  return match ? match[1] : null
}

export function getSessionFromRequest(req: IncomingMessage): string | null {
  return extractSessionFromCookie(req.headers.cookie)
}

export function cleanStaleSessions() {
  getDb().prepare('DELETE FROM sessions WHERE credentialHash != ?').run(getCredentialHash())
}
