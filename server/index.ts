import express from 'express'
import compression from 'compression'
import { renderPage } from 'vike/server'
import { attachWebSocket } from './ws.js'
import { initDb } from './db.js'
import { initEngine } from './engine.js'
import {
  isAuthEnabled,
  verifyCredentials,
  createSession,
  validateSession,
  getSessionFromRequest,
  cleanStaleSessions,
} from './auth.js'

const PORT = parseInt(process.env.PORT || '3000', 10)

async function startServer() {
  initDb()
  cleanStaleSessions()
  initEngine()

  const app = express()

  app.use(compression())
  app.use(express.json())
  app.use(express.static('dist/client', { index: false }))

  // ── Auth API endpoints ───────────────────────────
  app.get('/api/auth/status', (req, res) => {
    const authEnabled = isAuthEnabled()
    if (!authEnabled) {
      res.json({ authEnabled: false, authenticated: true })
      return
    }
    const sessionId = getSessionFromRequest(req)
    const authenticated = validateSession(sessionId)
    res.json({ authEnabled: true, authenticated })
  })

  app.post('/api/auth/login', (req, res) => {
    if (!isAuthEnabled()) {
      res.json({ success: true })
      return
    }
    const { username, password } = req.body || {}
    if (!verifyCredentials(username, password)) {
      res.status(401).json({ success: false, error: 'Invalid credentials' })
      return
    }
    const sessionId = createSession()
    res.setHeader('Set-Cookie', `kindo_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`)
    res.json({ success: true })
  })

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'kindo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
    res.json({ success: true })
  })

  // ── Vike page rendering ──────────────────────────
  app.get('{*path}', async (req, res) => {
    const pageContext = await renderPage({ urlOriginal: req.originalUrl })
    const { httpResponse } = pageContext

    if (!httpResponse) {
      res.status(404).send('Not Found')
      return
    }

    const { body, statusCode, headers } = httpResponse
    for (const [name, value] of headers) {
      res.setHeader(name, value)
    }
    res.status(statusCode).send(body)
  })

  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`)
    if (isAuthEnabled()) {
      console.log('Authentication is ENABLED (KINDO_UN/KINDO_PW set)')
    } else {
      console.log('Authentication is DISABLED (no KINDO_UN/KINDO_PW)')
    }
  })

  attachWebSocket(server)
}

startServer()
