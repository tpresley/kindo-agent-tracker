import { xs } from 'sygnal'
import type { Component } from 'sygnal'
import type { Agent, Run, AgentSummary, Webhook, AgentWebhookMap, WebhookFireLog, WsServerMessage } from '../server/types.js'
import {
  setBridgeListener,
  connectWs,
  loadApiKey,
  loadSelectedAgentIds,
  loadCachedAgents,
  cacheAgentData,
  loadWebhooks,
  loadAgentWebhookMap,
  loadDefaultWebhookId,
  loadWebhookLog,
  saveWebhookLog,
} from '../src/ws-bridge.js'

const isBrowser = typeof window !== 'undefined'
const savedKey = isBrowser ? loadApiKey() : ''
const savedIds = isBrowser ? loadSelectedAgentIds() : []
const cached = isBrowser ? loadCachedAgents() : { agents: [], runs: {}, fetchedAt: null }

const SETTINGS_KEY_LABELS: Record<string, string> = {
  apiKey: 'API Key',
  selectedAgentIds: 'Selected Agents',
  webhooks: 'Webhooks',
  agentWebhookMap: 'Agent Webhook Assignments',
  defaultWebhookId: 'Default Webhook',
}

type State = {
  apiKey: string
  selectedAgentIds: string[]
  agents: Agent[]
  runs: Record<string, Run>
  allAgents: AgentSummary[]
  models: Record<string, string>
  totalAgents: number
  lastFetchedAt: string | null
  connected: boolean
  loading: boolean
  error: string | null
  isOffline: boolean
  webhooks: Webhook[]
  agentWebhookMap: AgentWebhookMap
  defaultWebhookId: string | null
  webhookLog: WebhookFireLog[]
  webhookTestResults: Record<string, { success: boolean; httpStatus: number | null; error?: string }>
  overrideNotification: string[] | null
}

type Actions = {
  WS_EVENT: { type: string; data?: any }
  ONLINE_CHANGED: boolean
  AUTO_CONNECT: true
  DISMISS_OVERRIDE: Event
}

type Calculated = {
  activeRunCount: number
  needsSetup: boolean
}

type Wrapper = Component<State, {}, Actions, Calculated>

const Wrapper: Wrapper = function ({ state, children, innerHTML }) {
  return (
    <div className="app">
      {state.isOffline && (
        <div className="offline-bar">
          <span className="offline-icon">{'\u26A0'}</span> {state.connected ? 'Offline — showing cached data' : 'No internet connection'}
        </div>
      )}
      {state.overrideNotification && state.overrideNotification.length > 0 && (
        <div className="override-notification">
          <span>
            Settings updated from server: {state.overrideNotification.map(k => SETTINGS_KEY_LABELS[k] || k).join(', ')}
          </span>
          <button className="dismiss-override-btn">Dismiss</button>
        </div>
      )}
      {children && children.length
        ? children
        : <div props={{ innerHTML: innerHTML || '' }}></div>
      }
    </div>
  )
}

Wrapper.initialState = {
  apiKey: savedKey,
  selectedAgentIds: savedIds,
  agents: cached.agents as Agent[],
  runs: cached.runs as Record<string, Run>,
  allAgents: [],
  models: {},
  totalAgents: 0,
  lastFetchedAt: cached.fetchedAt,
  connected: false,
  loading: !!savedKey,
  error: null,
  isOffline: false,
  webhooks: isBrowser ? loadWebhooks() : [],
  agentWebhookMap: isBrowser ? loadAgentWebhookMap() : {},
  defaultWebhookId: isBrowser ? loadDefaultWebhookId() : null,
  webhookLog: isBrowser ? loadWebhookLog() : [],
  webhookTestResults: {},
  overrideNotification: null,
}

Wrapper.calculated = {
  activeRunCount: (state) => {
    const selectedRunIds = new Set<string>()
    for (const agent of state.agents) {
      if (agent.recentRunIds) {
        for (const rid of agent.recentRunIds) selectedRunIds.add(rid)
      }
    }
    return Object.entries(state.runs)
      .filter(([id, r]) => selectedRunIds.has(id) && r.status === 'in_progress')
      .length
  },
  needsSetup: (state) =>
    !state.apiKey || state.selectedAgentIds.length === 0,
}

Wrapper.context = {
  apiKey: (state) => state.apiKey,
  selectedAgentIds: (state) => state.selectedAgentIds,
  agents: (state) => state.agents,
  runs: (state) => state.runs,
  allAgents: (state) => state.allAgents,
  models: (state) => state.models,
  totalAgents: (state) => state.totalAgents,
  lastFetchedAt: (state) => state.lastFetchedAt,
  connected: (state) => state.connected,
  loading: (state) => state.loading,
  error: (state) => state.error,
  isOffline: (state) => state.isOffline,
  activeRunCount: (state) => (state as any).activeRunCount,
  needsSetup: (state) => (state as any).needsSetup,
  webhooks: (state) => state.webhooks,
  agentWebhookMap: (state) => state.agentWebhookMap,
  defaultWebhookId: (state) => state.defaultWebhookId,
  webhookLog: (state) => state.webhookLog,
  webhookTestResults: (state) => state.webhookTestResults,
}

Wrapper.intent = ({ DOM }) => ({
  WS_EVENT: isBrowser
    ? xs.create<{ type: string; data?: any }>({
        start: (listener) => {
          setBridgeListener((type, data) => {
            listener.next({ type, data })
          })
        },
        stop: () => {
          setBridgeListener(() => {})
        },
      })
    : xs.never(),

  ONLINE_CHANGED: isBrowser
    ? xs.create<boolean>({
        start: (listener) => {
          window.addEventListener('online', () => listener.next(true))
          window.addEventListener('offline', () => listener.next(false))
        },
        stop: () => {},
      })
    : xs.never(),

  AUTO_CONNECT: isBrowser && savedKey
    ? xs.create<true>({
        start: (listener) => {
          setTimeout(() => { listener.next(true); listener.complete() }, 200)
        },
        stop: () => {},
      })
    : xs.never(),

  DISMISS_OVERRIDE: DOM.click('.dismiss-override-btn'),
})

Wrapper.model = {
  WS_EVENT: (state, event) => {
    switch (event.type) {
      case 'WS_OPEN':
        return {
          ...state,
          connected: true,
          error: null,
          apiKey: loadApiKey(),
          selectedAgentIds: loadSelectedAgentIds(),
          webhooks: loadWebhooks(),
          agentWebhookMap: loadAgentWebhookMap(),
          defaultWebhookId: loadDefaultWebhookId(),
        }

      case 'WS_CLOSE':
        return { ...state, connected: false }

      case 'WS_MESSAGE': {
        const msg = event.data as WsServerMessage
        switch (msg.type) {
          case 'agentData': {
            const newAgents = msg.agents.length > 0 ? msg.agents : state.agents
            const newRuns = { ...state.runs, ...msg.runs }
            cacheAgentData(newAgents, newRuns, msg.fetchedAt)
            return {
              ...state,
              agents: newAgents,
              runs: newRuns,
              totalAgents: msg.totalAgents,
              lastFetchedAt: msg.fetchedAt,
              loading: false,
              error: null,
            }
          }
          case 'agentList':
            return {
              ...state,
              allAgents: msg.agents,
              totalAgents: msg.total,
              models: msg.models,
            }
          case 'error':
            return { ...state, error: msg.message, loading: false }
          case 'webhookFired': {
            const log = [...state.webhookLog, msg.log].slice(-50)
            saveWebhookLog(log)
            return { ...state, webhookLog: log }
          }
          case 'webhookTestResult':
            return {
              ...state,
              webhookTestResults: {
                ...state.webhookTestResults,
                [msg.webhookId]: { success: msg.success, httpStatus: msg.httpStatus, error: msg.error },
              },
            }
          case 'settingsSync': {
            // Server sent authoritative settings — update state from localStorage
            // (ws-bridge already applied to localStorage before emitting WS_MESSAGE)
            const s = msg.settings
            return {
              ...state,
              apiKey: s.apiKey || '',
              selectedAgentIds: s.selectedAgentIds,
              webhooks: s.webhooks,
              agentWebhookMap: s.agentWebhookMap,
              defaultWebhookId: s.defaultWebhookId,
              loading: false,
              overrideNotification: msg.overriddenKeys.length > 0 ? msg.overriddenKeys : null,
            }
          }
          default:
            return state
        }
      }

      case 'SELECTION_CHANGED':
        return { ...state, selectedAgentIds: event.data as string[] }

      case 'WEBHOOKS_CHANGED':
        return {
          ...state,
          webhooks: loadWebhooks(),
          agentWebhookMap: loadAgentWebhookMap(),
          defaultWebhookId: loadDefaultWebhookId(),
        }

      default:
        return state
    }
  },

  ONLINE_CHANGED: (state, isOnline) => ({
    ...state,
    isOffline: !isOnline,
  }),

  DISMISS_OVERRIDE: (state) => ({
    ...state,
    overrideNotification: null,
  }),

  AUTO_CONNECT: {
    EFFECT: () => {
      connectWs(savedKey, savedIds)
    },
  },
}

export default Wrapper
