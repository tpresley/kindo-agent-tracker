/**
 * WebSocket driver for Sygnal.
 *
 * Manages the WS connection lifecycle, auto-reconnect, and message routing.
 * Reads from localStorage for building configure messages (timestamps, settings).
 * Writes to localStorage when receiving settingsSync from server.
 */
import { xs } from 'sygnal'
import type { Stream } from 'xstream'
import type { WsClientMessage, WsServerMessage, SettingsSyncPayload } from '../../server/types.js'
import {
  loadWebhooks,
  loadAgentWebhookMap,
  loadDefaultWebhookId,
  loadTimestamps,
} from '../storage.js'

// ── Types ──────────────────────────────────────────────────

export type WsCommand =
  | { action: 'connect'; apiKey: string; selectedAgentIds: string[] }
  | { action: 'disconnect' }
  | { action: 'send'; msg: WsClientMessage }

type WsEvent =
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'message'; data: WsServerMessage }
  | { kind: 'error'; error: string }

export interface WsSource {
  select(kind: 'open'): Stream<void>
  select(kind: 'close'): Stream<void>
  select(kind: 'message'): Stream<WsServerMessage>
  select(kind: 'error'): Stream<string>
  select(kind?: string): Stream<any>
}

// ── Helpers ────────────────────────────────────────────────

const STORAGE_PREFIX = 'kindo-tracker'
const TS_PREFIX = `${STORAGE_PREFIX}-ts-`

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  // In dev, WS runs on a separate port to avoid conflicting with Vite's HMR WebSocket
  const isDev = import.meta.env.DEV
  const host = isDev ? `${location.hostname}:3001` : location.host
  return `${proto}//${host}/ws`
}

function buildConfigureMsg(apiKey: string, selectedAgentIds: string[]): WsClientMessage {
  return {
    type: 'configure',
    apiKey,
    selectedAgentIds,
    webhooks: loadWebhooks(),
    agentWebhookMap: loadAgentWebhookMap(),
    defaultWebhookId: loadDefaultWebhookId(),
    timestamps: loadTimestamps(),
  }
}

function applyServerSettings(settings: SettingsSyncPayload, timestamps: Record<string, string>) {
  if (settings.apiKey !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-apiKey`, settings.apiKey)
    if (timestamps.apiKey) localStorage.setItem(`${TS_PREFIX}apiKey`, timestamps.apiKey)
  }
  if (settings.selectedAgentIds !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-selectedAgents`, JSON.stringify(settings.selectedAgentIds))
    if (timestamps.selectedAgentIds) localStorage.setItem(`${TS_PREFIX}selectedAgentIds`, timestamps.selectedAgentIds)
  }
  if (settings.webhooks !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-webhooks`, JSON.stringify(settings.webhooks))
    if (timestamps.webhooks) localStorage.setItem(`${TS_PREFIX}webhooks`, timestamps.webhooks)
  }
  if (settings.agentWebhookMap !== undefined) {
    localStorage.setItem(`${STORAGE_PREFIX}-agentWebhookMap`, JSON.stringify(settings.agentWebhookMap))
    if (timestamps.agentWebhookMap) localStorage.setItem(`${TS_PREFIX}agentWebhookMap`, timestamps.agentWebhookMap)
  }
  if (settings.defaultWebhookId !== undefined) {
    if (settings.defaultWebhookId) {
      localStorage.setItem(`${STORAGE_PREFIX}-defaultWebhookId`, settings.defaultWebhookId)
    } else {
      localStorage.removeItem(`${STORAGE_PREFIX}-defaultWebhookId`)
    }
    if (timestamps.defaultWebhookId) localStorage.setItem(`${TS_PREFIX}defaultWebhookId`, timestamps.defaultWebhookId)
  }
}

// ── Driver ─────────────────────────────────────────────────

export function makeWsDriver() {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let lastApiKey: string | null = null
  let lastSelectedIds: string[] = []
  const MAX_RECONNECT_DELAY = 30_000

  let emitEvent: ((ev: WsEvent) => void) | null = null

  function sendRaw(msg: WsClientMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  function scheduleReconnect() {
    if (lastApiKey === null) return // Only skip if explicitly disconnected
    const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY)
    reconnectAttempt++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (lastApiKey !== null) {
        doConnect(lastApiKey, lastSelectedIds)
      }
    }, delay)
  }

  function doConnect(apiKey: string, selectedAgentIds: string[]) {
    lastApiKey = apiKey
    lastSelectedIds = selectedAgentIds
    reconnectAttempt = 0

    if (ws) { ws.close(); ws = null }

    ws = new WebSocket(getWsUrl())

    ws.onopen = () => {
      reconnectAttempt = 0
      emitEvent?.({ kind: 'open' })
      sendRaw(buildConfigureMsg(apiKey, selectedAgentIds))
      sendRaw({ type: 'fetchAgentList' })
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsServerMessage = JSON.parse(event.data)
        // Apply settingsSync to localStorage before emitting
        if (msg.type === 'settingsSync') {
          applyServerSettings(msg.settings, (msg as any).timestamps || {})
          lastApiKey = msg.settings.apiKey || null
          lastSelectedIds = msg.settings.selectedAgentIds
        }
        emitEvent?.({ kind: 'message', data: msg })
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      ws = null
      emitEvent?.({ kind: 'close' })
      scheduleReconnect()
    }

    ws.onerror = () => { /* onclose fires after */ }
  }

  function doDisconnect() {
    lastApiKey = null
    lastSelectedIds = []
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (ws) { ws.close(); ws = null }
  }

  return function wsDriver(sink$: Stream<WsCommand>): WsSource {
    sink$.subscribe({
      next: (cmd) => {
        if (!cmd) return
        switch (cmd.action) {
          case 'connect':
            doConnect(cmd.apiKey, cmd.selectedAgentIds)
            break
          case 'disconnect':
            doDisconnect()
            break
          case 'send':
            sendRaw(cmd.msg)
            break
        }
      },
      error: () => {},
      complete: () => doDisconnect(),
    })

    const event$ = xs.create<WsEvent>({
      start: (listener) => { emitEvent = (ev) => listener.next(ev) },
      stop: () => { emitEvent = null },
    })

    return {
      select: (kind?: string) => {
        if (!kind) return event$
        return event$
          .filter((ev) => ev.kind === kind)
          .map((ev) => {
            if (ev.kind === 'message') return (ev as any).data
            if (ev.kind === 'error') return (ev as any).error
            return undefined
          })
      },
    } as WsSource
  }
}
