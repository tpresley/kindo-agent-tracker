import express from 'express'
import compression from 'compression'
import { renderPage } from 'vike/server'
import { attachWebSocket } from './ws.js'
import { initDb } from './db.js'

const PORT = parseInt(process.env.PORT || '3000', 10)

async function startServer() {
  initDb()
  const app = express()

  app.use(compression())
  app.use(express.static('dist/client', { index: false }))

  app.get('*', async (req, res) => {
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
  })

  attachWebSocket(server)
}

startServer()
