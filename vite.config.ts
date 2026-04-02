import { defineConfig } from 'vite'
import vike from 'vike/plugin'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [
    sygnal({ disableHmr: true }),
    vike(),
    {
      name: 'ws-and-auth-server',
      configureServer(server) {
        // Auth API middleware for dev server
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/api/auth/')) return next()

          const {
            isAuthEnabled,
            verifyCredentials,
            createSession,
            validateSession,
            getSessionFromRequest,
          } = await import('./server/auth.js')

          if (req.url === '/api/auth/status' && req.method === 'GET') {
            const authEnabled = isAuthEnabled()
            if (!authEnabled) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ authEnabled: false, authenticated: true }))
              return
            }
            const sessionId = getSessionFromRequest(req)
            const authenticated = validateSession(sessionId)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ authEnabled: true, authenticated }))
            return
          }

          if (req.url === '/api/auth/login' && req.method === 'POST') {
            let body = ''
            req.on('data', (chunk: Buffer) => { body += chunk.toString() })
            req.on('end', () => {
              if (!isAuthEnabled()) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
                return
              }
              const { username, password } = JSON.parse(body || '{}')
              if (!verifyCredentials(username, password)) {
                res.writeHead(401, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }))
                return
              }
              const sessionId = createSession()
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': `kindo_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
              })
              res.end(JSON.stringify({ success: true }))
            })
            return
          }

          if (req.url === '/api/auth/logout' && req.method === 'POST') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': 'kindo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
            })
            res.end(JSON.stringify({ success: true }))
            return
          }

          next()
        })

        // WS server on separate port in dev to avoid conflicting with Vite's HMR WebSocket
        import('node:http').then(async ({ createServer }) => {
          const { initDb } = await import('./server/db.js')
          const { cleanStaleSessions } = await import('./server/auth.js')
          initDb()
          cleanStaleSessions()
          const { initEngine } = await import('./server/engine.js')
          initEngine()
          const wsHttp = createServer()
          const { attachWebSocket } = await import('./server/ws.js')
          attachWebSocket(wsHttp)
          wsHttp.listen(3001, () => {
            console.log('[ws] WebSocket server listening on port 3001')
          })
        })
      },
    },
  ],
})
