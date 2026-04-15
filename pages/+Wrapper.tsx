import { xs, ABORT } from 'sygnal'
import type { Component, Event as SygnalEvent } from 'sygnal'
import type { Agent, Run, AgentSummary, Webhook, AgentWebhookMap, WebhookFireLog, WsServerMessage } from '../server/types.js'
import type { WsCommand } from '../src/drivers/ws.js'
import type { HttpRequest, HttpResponse } from '../src/drivers/http.js'
import type { AppDrivers, AppContext, VikeShellProps } from '../src/types.js'
import {
  loadApiKey,
  loadSelectedAgentIds,
  loadCachedAgents,
  cacheAgentData,
  loadWebhooks,
  loadAgentWebhookMap,
  loadDefaultWebhookId,
  loadWebhookLog,
  saveWebhookLog,
  loadTimestamps,
} from '../src/storage.js'

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
  authChecked: boolean
  authEnabled: boolean
  authenticated: boolean
  loginUsername: string
  loginPassword: string
  loginError: string | null
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
  suppressNextOverride: boolean
}

type Actions = {
  WS_OPEN: void
  WS_CLOSE: void
  WS_MESSAGE: WsServerMessage
  ONLINE_CHANGED: boolean
  INIT_AUTH: true
  AUTH_STATUS: HttpResponse
  LOGIN_USERNAME: string
  LOGIN_PASSWORD: string
  LOGIN_SUBMIT: Event
  LOGIN_RESULT: HttpResponse
  DISMISS_OVERRIDE: Event
  SELECTION_CHANGED: string[]
  WEBHOOKS_CHANGED: any
  LOGOUT_REQUEST: any
  LOGOUT_DONE: HttpResponse
}

type Calculated = {
  activeRunCount: number
  needsSetup: boolean
}

type Wrapper = Component<State, VikeShellProps, AppDrivers, Actions, Calculated, {}>

const Wrapper: Wrapper = function ({ state, children, innerHTML }) {
  if (state.authChecked && state.authEnabled && !state.authenticated) {
    return (
      <div className="app">
        <div className="login-container">
          <div className="login-card">
            <div className="login-header">
              <img src="/favicon.svg" alt="Kindo" className="login-logo" />
              <h1>Kindo Agent Tracker</h1>
              <p className="login-tagline">Sign in to continue</p>
            </div>
            <div className="login-form">
              <label className="input-label">Username</label>
              <input type="text" className="login-username-input api-key-input" placeholder="Username" value={state.loginUsername} />
              <label className="input-label">Password</label>
              <input type="password" className="login-password-input api-key-input" placeholder="Password" value={state.loginPassword} />
              {state.loginError && <div className="error-message">{state.loginError}</div>}
              <button className="login-submit-btn submit-key-btn" disabled={!state.loginUsername.trim() || !state.loginPassword.trim()}>Sign In</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!state.authChecked) {
    return <div className="app"><div className="loading-state"><div className="spinner" /></div></div>
  }

  return (
    <div className="app">
      {state.isOffline && (
        <div className="offline-bar">
          <span className="offline-icon">{'\u26A0'}</span> {state.connected ? 'Offline — showing cached data' : 'No internet connection'}
        </div>
      )}
      {state.overrideNotification && state.overrideNotification.length > 0 && (
        <div className="override-notification">
          <span>Settings updated from server: {state.overrideNotification.map(k => SETTINGS_KEY_LABELS[k] || k).join(', ')}</span>
          <button className="dismiss-override-btn">Dismiss</button>
        </div>
      )}
      {children && (children as any[]).length
        ? children
        : <div props={{ innerHTML: innerHTML || '' }}></div>
      }
    </div>
  )
}

Wrapper.initialState = {
  authChecked: false,
  authEnabled: false,
  authenticated: false,
  loginUsername: '',
  loginPassword: '',
  loginError: null,
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
  suppressNextOverride: false,
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
  needsSetup: (state) => !state.apiKey || state.selectedAgentIds.length === 0,
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
  authEnabled: (state) => state.authEnabled,
}

Wrapper.intent = ({ DOM, WS, EVENTS, HTTP }: any) => ({
  WS_OPEN:    WS.select('open'),
  WS_CLOSE:   WS.select('close'),
  WS_MESSAGE: WS.select('message'),

  ONLINE_CHANGED: isBrowser
    ? xs.create<boolean>({
        start: (listener) => {
          window.addEventListener('online', () => listener.next(true))
          window.addEventListener('offline', () => listener.next(false))
        },
        stop: () => {},
      })
    : xs.never(),

  // Fire once on startup to trigger auth check via HTTP driver
  INIT_AUTH: isBrowser
    ? xs.of(true as const)
    : xs.never(),

  AUTH_STATUS: HTTP.select('auth-status').filter((r: any) => !!r),

  DISMISS_OVERRIDE: DOM.click('.dismiss-override-btn'),

  LOGIN_USERNAME: DOM.input('.login-username-input').value(),
  LOGIN_PASSWORD: DOM.input('.login-password-input').value(),
  LOGIN_SUBMIT: xs.merge(
    DOM.click('.login-submit-btn'),
    DOM.keydown('.login-password-input').key().filter((k: string) => k === 'Enter'),
  ),
  LOGIN_RESULT: HTTP.select('auth-login').filter((r: any) => !!r),

  SELECTION_CHANGED: EVENTS.select('SELECTION_CHANGED'),
  WEBHOOKS_CHANGED:  EVENTS.select('WEBHOOKS_CHANGED'),
  LOGOUT_REQUEST:    EVENTS.select('LOGOUT'),
  LOGOUT_DONE:       HTTP.select('auth-logout').filter((r: any) => !!r),
})

Wrapper.model = {
  INIT_AUTH: {
    HTTP: (): HttpRequest => ({ id: 'auth-status', url: '/api/auth/status' }),
  },

  AUTH_STATUS: {
    STATE: (state: State, resp: HttpResponse) => {
      const data = resp.error ? { authEnabled: false, authenticated: true } : resp.data
      return { ...state, authChecked: true, authEnabled: data.authEnabled, authenticated: data.authenticated }
    },
    WS: (_state: State, resp: HttpResponse): WsCommand | undefined => {
      const data = resp.error ? { authenticated: true } : resp.data
      if (data.authenticated) return { action: 'connect', apiKey: savedKey || '', selectedAgentIds: savedIds }
      return undefined
    },
  },

  LOGIN_USERNAME: (state: State, value: string) => ({ ...state, loginUsername: value }),
  LOGIN_PASSWORD: (state: State, value: string) => ({ ...state, loginPassword: value }),

  LOGIN_SUBMIT: {
    STATE: (state: State) => {
      if (!state.loginUsername.trim() || !state.loginPassword.trim()) return ABORT
      return { ...state, loginError: null }
    },
    HTTP: (state: State): HttpRequest | undefined => {
      const username = state.loginUsername.trim()
      const password = state.loginPassword.trim()
      if (!username || !password) return undefined
      return { id: 'auth-login', url: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }
    },
  },

  LOGIN_RESULT: {
    STATE: (state: State, resp: HttpResponse) => {
      if (resp.data?.success) return { ...state, authenticated: true, loginUsername: '', loginPassword: '', loginError: null, suppressNextOverride: true }
      return { ...state, loginError: resp.data?.error || resp.error || 'Login failed' }
    },
    WS: (_state: State, resp: HttpResponse): WsCommand | undefined => {
      if (resp.data?.success) {
        return { action: 'connect', apiKey: loadApiKey() || '', selectedAgentIds: loadSelectedAgentIds() }
      }
      return undefined
    },
  },

  WS_OPEN: (state: State) => ({
    ...state, connected: true, error: null,
    apiKey: loadApiKey(), selectedAgentIds: loadSelectedAgentIds(),
    webhooks: loadWebhooks(), agentWebhookMap: loadAgentWebhookMap(), defaultWebhookId: loadDefaultWebhookId(),
  }),

  WS_CLOSE: (state: State) => ({ ...state, connected: false }),

  WS_MESSAGE: (state: State, msg: WsServerMessage) => {
    switch (msg.type) {
      case 'agentData': {
        const newAgents = msg.agents.length > 0 ? msg.agents : state.agents
        const newRuns = { ...state.runs, ...msg.runs }
        cacheAgentData(newAgents, newRuns, msg.fetchedAt)
        return { ...state, agents: newAgents, runs: newRuns, totalAgents: msg.totalAgents, lastFetchedAt: msg.fetchedAt, loading: false, error: null }
      }
      case 'agentList':
        return { ...state, allAgents: msg.agents, totalAgents: msg.total, models: msg.models }
      case 'error':
        return { ...state, error: msg.message, loading: false }
      case 'webhookFired': {
        const log = [...state.webhookLog, msg.log].slice(-50)
        saveWebhookLog(log)
        return { ...state, webhookLog: log }
      }
      case 'webhookTestResult':
        return { ...state, webhookTestResults: { ...state.webhookTestResults, [msg.webhookId]: { success: msg.success, httpStatus: msg.httpStatus, error: msg.error } } }
      case 'settingsSync': {
        const s = msg.settings
        const showOverride = !state.suppressNextOverride && msg.overriddenKeys.length > 0
        return { ...state, apiKey: s.apiKey || '', selectedAgentIds: s.selectedAgentIds, webhooks: s.webhooks, agentWebhookMap: s.agentWebhookMap, defaultWebhookId: s.defaultWebhookId, loading: false, overrideNotification: showOverride ? msg.overriddenKeys : null, suppressNextOverride: false }
      }
      default:
        return state
    }
  },

  ONLINE_CHANGED: (state: State, isOnline: boolean) => ({ ...state, isOffline: !isOnline }),
  DISMISS_OVERRIDE: (state: State) => ({ ...state, overrideNotification: null }),

  SELECTION_CHANGED: {
    STATE: (state: State, ids: string[]) => ({ ...state, selectedAgentIds: ids }),
    WS: (): WsCommand => ({
      action: 'send',
      msg: { type: 'configure', apiKey: loadApiKey(), selectedAgentIds: loadSelectedAgentIds(), webhooks: loadWebhooks(), agentWebhookMap: loadAgentWebhookMap(), defaultWebhookId: loadDefaultWebhookId(), timestamps: loadTimestamps() },
    }),
  },

  WEBHOOKS_CHANGED: {
    STATE: (state: State) => ({ ...state, webhooks: loadWebhooks(), agentWebhookMap: loadAgentWebhookMap(), defaultWebhookId: loadDefaultWebhookId() }),
    WS: (): WsCommand => ({
      action: 'send',
      msg: { type: 'configure', apiKey: loadApiKey(), selectedAgentIds: loadSelectedAgentIds(), webhooks: loadWebhooks(), agentWebhookMap: loadAgentWebhookMap(), defaultWebhookId: loadDefaultWebhookId(), timestamps: loadTimestamps() },
    }),
  },

  LOGOUT_REQUEST: {
    HTTP: (): HttpRequest => ({ id: 'auth-logout', url: '/api/auth/logout', method: 'POST' }),
  },

  LOGOUT_DONE: {
    EFFECT: () => { window.location.href = '/' },
  },
}

export default Wrapper
