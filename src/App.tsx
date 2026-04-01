import { xs, ABORT, onlineStatus$, createInstallPrompt, classes } from 'sygnal'
import type { RootComponent } from 'sygnal'
import type { Agent, Run, KindoCommand, KindoResponse } from './drivers/kindoApi'
import { loadCachedData, loadApiKey, saveApiKey, clearApiKey } from './drivers/kindoApi'

const installPrompt = createInstallPrompt()

const cached = loadCachedData()
const savedKey = loadApiKey()

type State = {
  apiKey: string
  apiKeyInput: string
  agents: Agent[]
  runs: Record<string, Run>
  totalAgents: number
  lastFetchedAt: string | null
  isPolling: boolean
  loading: boolean
  error: string | null
  isOffline: boolean
  updateAvailable: boolean
  canInstall: boolean
  view: 'setup' | 'dashboard'
  collapsedAgents: Record<string, boolean>
}

type Actions = {
  UPDATE_KEY_INPUT: string
  SUBMIT_KEY: Event
  LOGOUT: Event
  AUTO_START: true
  KINDO_DATA: KindoResponse
  ONLINE_CHANGED: boolean
  SW_WAITING: any
  SW_CONTROLLING: any
  APPLY_UPDATE: Event
  INSTALL: Event
  REFRESH: Event
  TOGGLE_AGENT: string
}

type Calculated = {
  activeRunCount: number
  agentCards: Array<Agent & { runs: Run[] }>
}

type App = RootComponent<State, {}, Actions, Calculated>

function formatLastFetched(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 10) return 'Just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return new Date(iso).toLocaleTimeString()
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'running...'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return '<1s'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  if (mins < 60) return `${mins}m ${remSecs}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

const statusLabels: Record<string, string> = {
  in_progress: 'Running',
  success: 'Success',
  failure: 'Failed',
  cancelled: 'Cancelled',
}

const statusIcons: Record<string, string> = {
  in_progress: '\u25CF',
  success: '\u2713',
  failure: '\u2717',
  cancelled: '\u2014',
}

function renderAgentCard(agent: Agent & { runs: Run[] }, collapsed: boolean) {
  const activeCount = agent.runs.filter(r => r.status === 'in_progress').length
  const hasActive = activeCount > 0

  return (
    <div className={classes('agent-card', { 'has-active': hasActive })} key={agent.agentId}>
      <div className="agent-header toggle-agent" attrs={{ 'data-agentid': agent.agentId }}>
        <div className="agent-info">
          <div className="agent-name-row">
            <h3 className="agent-name">{agent.name || 'Unnamed Agent'}</h3>
            {hasActive && <span className="active-badge">{activeCount} running</span>}
            {agent.hasTriggers && <span className="trigger-badge">Triggered</span>}
          </div>
          {agent.description && (
            <p className="agent-description">{agent.description}</p>
          )}
          <div className="agent-meta">
            {agent.modelsInUse && agent.modelsInUse.length > 0 && (
              <span className="meta-item models">
                {agent.modelsInUse.join(', ')}
              </span>
            )}
            <span className="meta-item last-run">
              Last run: {formatRelativeTime(agent.lastRunAtUtc)}
            </span>
            <span className="meta-item run-count">
              {agent.runs.length} recent run{agent.runs.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <span className="collapse-icon">{collapsed ? '\u25B6' : '\u25BC'}</span>
      </div>

      {!collapsed && (
        <div className="runs-list">
          {agent.runs.length === 0 ? (
            <div className="no-runs">No recent runs</div>
          ) : (
            agent.runs.map(run => (
              <div key={run.runId} className={classes('run-item', run.status)}>
                <div className="run-header">
                  <span className={classes('status-badge', run.status)}>
                    {run.status === 'in_progress' && <span className="pulse" />}
                    <span className="status-icon">{statusIcons[run.status]}</span>
                    {statusLabels[run.status] || run.status}
                  </span>
                  <span className="run-time">{formatTime(run.createdAtUtc)}</span>
                  <span className="run-duration">
                    {formatDuration(run.createdAtUtc, run.endedAtUtc)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

const App: App = function ({ state }) {
  if (state.view === 'setup') {
    return (
      <div className="app">
        {state.isOffline && (
          <div className="offline-bar">
            <span className="offline-icon">{'\u26A0'}</span> No internet connection
          </div>
        )}

        <div className="setup-container">
          <div className="setup-card">
            <div className="setup-header">
              <img src="/favicon.svg" alt="Kindo" className="setup-logo" />
              <h1>Kindo Agent Tracker</h1>
              <p className="setup-tagline">Monitor your agent runs in real-time</p>
            </div>

            <div className="setup-form">
              <label className="input-label" attrs={{ for: 'api-key' }}>API Key</label>
              <input
                type="password"
                id="api-key"
                className="api-key-input"
                placeholder="Enter your Kindo API key..."
                value={state.apiKeyInput}
              />
              <p className="input-hint">
                Find your API key at{' '}
                <a href="https://app.kindo.ai/settings/api" target="_blank" rel="noopener">
                  app.kindo.ai/settings/api
                </a>
              </p>
              <button
                className="submit-key-btn"
                attrs={{ disabled: !state.apiKeyInput.trim() }}
              >
                Connect
              </button>
            </div>

            {state.error && (
              <div className="error-message">{state.error}</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {state.isOffline && (
        <div className="offline-bar">
          <span className="offline-icon">{'\u26A0'}</span> Offline — showing cached data
        </div>
      )}

      {state.updateAvailable && (
        <div className="update-bar">
          <span>A new version is available</span>
          <button className="update-btn">Update now</button>
        </div>
      )}

      <header className="dashboard-header">
        <div className="header-left">
          <img src="/favicon.svg" alt="Kindo" className="header-logo" />
          <div>
            <h1 className="header-title">Kindo Agent Tracker</h1>
            <div className="header-meta">
              <span className={`connection-status ${state.isOffline ? 'offline' : 'online'}`}>
                <span className="status-dot" />
                {state.isOffline ? 'Offline' : 'Connected'}
              </span>
              <span className="separator">{'\u00B7'}</span>
              <span className="last-fetched">Updated: {formatLastFetched(state.lastFetchedAt)}</span>
              {state.totalAgents > 0 && (
                <span className="total-agents">{state.agents.length} of {state.totalAgents} agents</span>
              )}
              {state.activeRunCount > 0 && (
                <span className="active-indicator">
                  <span className="pulse" />
                  {state.activeRunCount} active
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="header-actions">
          <button className="refresh-btn" attrs={{ disabled: state.loading || state.isOffline }}>
            Refresh
          </button>
          <button className="logout-btn">Disconnect</button>
        </div>
      </header>

      <main className="dashboard-main">
        {state.error && (
          <div className="error-banner">
            <span>{'\u26A0'}</span> {state.error}
          </div>
        )}

        {state.loading && state.agents.length === 0 && (
          <div className="loading-state">
            <div className="spinner" />
            <p>Loading agents...</p>
          </div>
        )}

        {!state.loading && state.agents.length === 0 && !state.error && (
          <div className="empty-state">
            <p>No agents found in your Kindo account.</p>
          </div>
        )}

        <div className="agents-grid">
          {state.agentCards.map(agent =>
            renderAgentCard(agent, !!state.collapsedAgents[agent.agentId])
          )}
        </div>

        {state.canInstall && (
          <div className="install-card">
            <button className="install-btn">Install App</button>
          </div>
        )}

        <div className="polling-indicator">
          {state.isPolling && !state.isOffline && (
            <span className="polling-text">
              Polling every {state.activeRunCount > 0 ? '10s' : '60s'}
              {state.loading && ' \u2022 fetching...'}
            </span>
          )}
        </div>
      </main>
    </div>
  )
}

App.initialState = {
  apiKey: savedKey,
  apiKeyInput: '',
  agents: cached.agents,
  runs: cached.runs,
  totalAgents: cached.totalAgents,
  lastFetchedAt: cached.fetchedAt,
  isPolling: !!savedKey,
  loading: !!savedKey,
  error: null,
  isOffline: false,
  updateAvailable: false,
  canInstall: false,
  view: savedKey ? 'dashboard' : 'setup',
  collapsedAgents: {},
}

App.calculated = {
  activeRunCount: (state) =>
    Object.values(state.runs).filter(r => r.status === 'in_progress').length,

  agentCards: (state) =>
    state.agents.map(agent => ({
      ...agent,
      runs: (agent.recentRunIds || [])
        .map(id => state.runs[id])
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime()),
    })),
}

App.intent = ({ DOM, SW, KINDO }) => ({
  UPDATE_KEY_INPUT: DOM.input('.api-key-input').value(),
  SUBMIT_KEY:       xs.merge(
    DOM.click('.submit-key-btn'),
    DOM.keydown('.api-key-input').key().filter(key => key === 'Enter'),
  ),
  LOGOUT:           DOM.click('.logout-btn'),
  REFRESH:          DOM.click('.refresh-btn'),
  TOGGLE_AGENT:     DOM.click('.toggle-agent').data('agentid'),
  KINDO_DATA:       KINDO.select('data'),
  ONLINE_CHANGED:   onlineStatus$,
  SW_WAITING:       SW.select('waiting'),
  SW_CONTROLLING:   SW.select('controlling'),
  APPLY_UPDATE:     DOM.click('.update-btn'),
  INSTALL:          DOM.click('.install-btn'),
  AUTO_START:       savedKey
    ? xs.create<true>({
        start: (listener) => { setTimeout(() => { listener.next(true); listener.complete() }, 100) },
        stop: () => {},
      })
    : xs.never(),
})

App.model = {
  UPDATE_KEY_INPUT: (state, value) => ({
    ...state,
    apiKeyInput: value,
  }),

  SUBMIT_KEY: {
    STATE: (state) => {
      const key = state.apiKeyInput.trim()
      if (!key) return ABORT
      saveApiKey(key)
      return {
        ...state,
        apiKey: key,
        apiKeyInput: '',
        view: 'dashboard' as const,
        loading: true,
        error: null,
        isPolling: true,
      }
    },
    KINDO: (state) => {
      const key = state.apiKeyInput.trim()
      if (!key) return ABORT
      return { action: 'start', apiKey: key } as KindoCommand
    },
  },

  LOGOUT: {
    STATE: (state) => {
      clearApiKey()
      return {
        ...state,
        apiKey: '',
        view: 'setup' as const,
        agents: [],
        runs: {},
        totalAgents: 0,
        lastFetchedAt: null,
        isPolling: false,
        error: null,
        collapsedAgents: {},
      }
    },
    KINDO: () => ({ action: 'stop' } as KindoCommand),
  },

  REFRESH: {
    STATE: (state) => {
      if (state.isOffline || state.loading) return ABORT
      return { ...state, loading: true }
    },
    KINDO: () => ({ action: 'poll' } as KindoCommand),
  },

  TOGGLE_AGENT: (state, agentId) => ({
    ...state,
    collapsedAgents: {
      ...state.collapsedAgents,
      [agentId]: !state.collapsedAgents[agentId],
    },
  }),

  AUTO_START: {
    KINDO: () => ({ action: 'start', apiKey: savedKey } as KindoCommand),
  },

  KINDO_DATA: (state, data) => ({
    ...state,
    agents: data.agents.length > 0 ? data.agents : state.agents,
    runs: { ...state.runs, ...data.runs },
    totalAgents: data.totalAgents || state.totalAgents,
    lastFetchedAt: data.fetchedAt,
    loading: false,
    error: data.error || null,
  }),

  ONLINE_CHANGED: (state, isOnline) => ({
    ...state,
    isOffline: !isOnline,
  }),

  SW_WAITING: (state) => ({
    ...state,
    updateAvailable: true,
  }),

  SW_CONTROLLING: (state) => ({
    ...state,
    updateAvailable: false,
  }),

  APPLY_UPDATE: {
    SW: () => ({ action: 'skipWaiting' }),
    EFFECT: () => {
      window.location.reload()
    },
  },

  INSTALL: {
    EFFECT: () => {
      installPrompt.prompt()
    },
    STATE: (state) => ({
      ...state,
      canInstall: false,
    }),
  },
}

export default App
