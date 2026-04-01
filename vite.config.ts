import { defineConfig } from 'vite'
import vike from 'vike/plugin'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [
    sygnal({ disableHmr: true }),
    vike(),
    {
      name: 'ws-server',
      configureServer(server) {
        // Use a separate HTTP server for our app WS to avoid conflicting with Vite HMR
        import('node:http').then(async ({ createServer }) => {
          const { initDb } = await import('./server/db.js')
          initDb()
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
