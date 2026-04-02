/**
 * WebSocket server — thin layer that handles connections, auth,
 * settings sync, and delegates to the polling engine.
 */
import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer } from 'node:http'
import type { WsClientMessage, WsServerMessage, SettingsSyncPayload } from './types.js'
import { fetchAgentList, fetchModelMap } from './kindo.js'
import { isAuthEnabled, validateSession, extractSessionFromCookie } from './auth.js'
import { resolveSettings, loadSettingsForClient, getAllSettings } from './db.js'
import { registerListener, unregisterListener, reloadConfig, forceRefresh, fireTestWebhook } from './engine.js'

function send(ws: WebSocket, msg: WsServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function buildSettingsSyncPayload(): SettingsSyncPayload {
  const db = loadSettingsForClient()
  return {
    apiKey: db.apiKey || '',
    selectedAgentIds: db.selectedAgentIds,
    webhooks: db.webhooks,
    agentWebhookMap: db.agentWebhookMap,
    defaultWebhookId: db.defaultWebhookId,
  }
}

// ── Message handling ───────────────────────────────────────

async function handleMessage(ws: WebSocket, msg: WsClientMessage) {
  switch (msg.type) {
    case 'configure': {
      // Resolve settings against SQLite
      const timestamps = msg.timestamps || {}
      const NO_OPINION = '1970-01-01T00:00:00.000Z'
      const clientEntries = [
        { key: 'apiKey', value: msg.apiKey, updatedAt: timestamps.apiKey || NO_OPINION },
        { key: 'selectedAgentIds', value: JSON.stringify(msg.selectedAgentIds), updatedAt: timestamps.selectedAgentIds || NO_OPINION },
        { key: 'webhooks', value: JSON.stringify(msg.webhooks || []), updatedAt: timestamps.webhooks || NO_OPINION },
        { key: 'agentWebhookMap', value: JSON.stringify(msg.agentWebhookMap || {}), updatedAt: timestamps.agentWebhookMap || NO_OPINION },
        { key: 'defaultWebhookId', value: msg.defaultWebhookId ?? '', updatedAt: timestamps.defaultWebhookId || NO_OPINION },
      ]

      const { resolvedTimestamps, overriddenKeys } = resolveSettings(clientEntries)

      // Send authoritative state back to client
      send(ws, {
        type: 'settingsSync',
        settings: buildSettingsSyncPayload(),
        overriddenKeys,
        timestamps: resolvedTimestamps,
      })

      // Tell the engine to pick up the new config from SQLite
      reloadConfig()
      break
    }

    case 'refresh': {
      forceRefresh()
      break
    }

    case 'fetchAgentList': {
      const db = loadSettingsForClient()
      if (!db.apiKey) {
        send(ws, { type: 'error', message: 'No API key configured' })
        return
      }
      try {
        const [{ agents, total }, models] = await Promise.all([
          fetchAgentList(db.apiKey),
          fetchModelMap(db.apiKey),
        ])
        send(ws, { type: 'agentList', agents, total, models })
      } catch (err: any) {
        send(ws, { type: 'error', message: err.message || 'Failed to fetch agent list' })
      }
      break
    }

    case 'testWebhook': {
      const result = await fireTestWebhook(msg.webhook)
      send(ws, {
        type: 'webhookTestResult',
        webhookId: msg.webhook.id,
        httpStatus: result.httpStatus,
        success: result.success,
        error: result.error,
      })
      break
    }

    case 'getSettings': {
      const allSettings = getAllSettings()
      const ts: Record<string, string> = {}
      for (const [k, v] of Object.entries(allSettings)) ts[k] = v.updatedAt
      send(ws, {
        type: 'settingsSync',
        settings: buildSettingsSyncPayload(),
        overriddenKeys: [],
        timestamps: ts,
      })
      break
    }
  }
}

// ── WebSocket server ───────────────────────────────────────

export function attachWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, callback) => {
      if (!isAuthEnabled()) {
        callback(true)
        return
      }
      const sessionId = extractSessionFromCookie(info.req.headers.cookie)
      if (validateSession(sessionId)) {
        callback(true)
      } else {
        callback(false, 401, 'Unauthorized')
      }
    },
  })

  wss.on('connection', (ws) => {
    // Register this client to receive engine broadcasts
    const listener = (msg: WsServerMessage) => send(ws, msg)
    registerListener(listener)

    ws.on('message', (raw) => {
      try {
        const msg: WsClientMessage = JSON.parse(String(raw))
        handleMessage(ws, msg)
      } catch {
        send(ws, { type: 'error', message: 'Invalid message' })
      }
    })

    ws.on('close', () => unregisterListener(listener))
    ws.on('error', () => unregisterListener(listener))
  })

  return wss
}
