import { xs, ABORT } from 'sygnal'
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
  // Auth state
  authChecked: boolean
  authEnabled: boolean
  authenticated: boolean
  loginUsername: string
  loginPassword: string
  loginError: string | null
  // App state
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
  // Auth actions
  AUTH_STATUS: { authEnabled: boolean; authenticated: boolean }
  LOGIN_USERNAME: string
  LOGIN_PASSWORD: string
  LOGIN_SUBMIT: Event
  LOGIN_RESULT: { success: boolean; error?: string }
}

type Calculated = {
  activeRunCount: number
  needsSetup: boolean
}

type Wrapper = Component<State, {}, Actions, Calculated>

const Wrapper: Wrapper = function ({ state, children, innerHTML }) {
  // Show login form if auth is required and not authenticated
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
              <button className="login-submit-btn submit-key-btn" attrs={{ disabled: !state.loginUsername.trim() || !state.loginPassword.trim() }}>
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show loading while checking auth
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
      {children && children.length
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
  authEnabled: (state) => state.authEnabled,
}

Wrapper.intent = ({ DOM }) => ({
  WS_EVENT: isBrowser
    ? xs.create<{ type: string; data?: any }>({
        start: (listener) => {
          setBridgeListener((type, data) => { listener.next({ type, data }) })
        },
        stop: () => { setBridgeListener(() => {}) },
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

  // Check auth status on load
  AUTH_STATUS: isBrowser
    ? xs.create<{ authEnabled: boolean; authenticated: boolean }>({
        start: (listener) => {
          fetch('/api/auth/status')
            .then(r => r.json())
            .then(data => { listener.next(data); listener.complete() })
            .catch(() => {
              // If fetch fails (offline), assume no auth needed
              listener.next({ authEnabled: false, authenticated: true })
              listener.complete()
            })
        },
        stop: () => {},
      })
    : xs.never(),

  AUTO_CONNECT: xs.never(), // Will be triggered after auth check

  DISMISS_OVERRIDE: DOM.click('.dismiss-override-btn'),

  // Auth form
  LOGIN_USERNAME: DOM.input('.login-username-input').value(),
  LOGIN_PASSWORD: DOM.input('.login-password-input').value(),
  LOGIN_SUBMIT: xs.merge(
    DOM.click('.login-submit-btn'),
    DOM.keydown('.login-password-input').key().filter((k: string) => k === 'Enter'),
  ),
  LOGIN_RESULT: xs.never(), // Populated by EFFECT
})

Wrapper.model = {
  AUTH_STATUS: (state, data, next) => {
    const newState = {
      ...state,
      authChecked: true,
      authEnabled: data.authEnabled,
      authenticated: data.authenticated,
    }
    // If authenticated (or no auth needed), auto-connect
    if (data.authenticated && savedKey) {
      setTimeout(() => {
        connectWs(savedKey, savedIds)
      }, 200)
    }
    return newState
  },

  LOGIN_USERNAME: (state, value) => ({ ...state, loginUsername: value }),
  LOGIN_PASSWORD: (state, value) => ({ ...state, loginPassword: value }),

  LOGIN_SUBMIT: {
    STATE: (state) => {
      if (!state.loginUsername.trim() || !state.loginPassword.trim()) return ABORT
      return { ...state, loginError: null }
    },
    EFFECT: (state, _data, next) => {
      const username = state.loginUsername.trim()
      const password = state.loginPassword.trim()
      if (!username || !password) return
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
        .then(r => r.json())
        .then(data => {
          next!('LOGIN_RESULT', data)
        })
        .catch(() => {
          next!('LOGIN_RESULT', { success: false, error: 'Network error' })
        })
    },
  },

  LOGIN_RESULT: {
    STATE: (state, data) => {
      if (data.success) {
        return {
          ...state,
          authenticated: true,
          loginUsername: '',
          loginPassword: '',
          loginError: null,
          suppressNextOverride: true,
        }
      }
      return { ...state, loginError: data.error || 'Login failed' }
    },
    EFFECT: (_state, data) => {
      if (data.success) {
        const key = loadApiKey()
        const ids = loadSelectedAgentIds()
        if (key) {
          setTimeout(() => connectWs(key, ids), 200)
        }
      }
    },
  },

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
      }
      case 'SELECTION_CHANGED':
        return { ...state, selectedAgentIds: event.data as string[] }
      case 'WEBHOOKS_CHANGED':
        return { ...state, webhooks: loadWebhooks(), agentWebhookMap: loadAgentWebhookMap(), defaultWebhookId: loadDefaultWebhookId() }
      default:
        return state
    }
  },

  ONLINE_CHANGED: (state, isOnline) => ({ ...state, isOffline: !isOnline }),
  DISMISS_OVERRIDE: (state) => ({ ...state, overrideNotification: null }),
  AUTO_CONNECT: (state) => state,
}

export default Wrapper
