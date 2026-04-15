import { xs, classes } from 'sygnal'
import type { Component } from 'sygnal'
import type { Agent, Run, WebhookFireLog } from '../../server/types.js'
import type { AppDrivers, AppContext } from '../../src/types.js'
import type { WsCommand } from '../../src/drivers/ws.js'

type State = {
  collapsedAgents: Record<string, boolean>
  compactView: boolean
  modalAgentId: string | null
}

type Actions = {
  INIT_VIEW: true
  TOGGLE_AGENT: string
  REFRESH: Event
  TOGGLE_VIEW: Event
  OPEN_MODAL: string
  CLOSE_MODAL: Event
}

type Page = Component<State, {}, AppDrivers, Actions, {}, AppContext>

import { formatTime, formatRelativeTime, formatDuration } from '../../src/time.js'

const KINDO_RUN_URL = 'https://app.kindo.ai/chat?workflowRunId='

const statusLabels: Record<string, string> = {
  in_progress: 'Running', success: 'Success', failure: 'Failed', cancelled: 'Cancelled',
}

const statusIcons: Record<string, string> = {
  in_progress: '\u25CF', success: '\u2713', failure: '\u2717', cancelled: '\u2014',
}

// ── Run list (shared between card and modal) ───────────────

function renderRunList(runs: Run[]) {
  if (runs.length === 0) return <div className="no-runs">No recent runs</div>
  return runs.map((run) => (
    <a key={run.runId} className={classes('run-item', run.status)} href={`${KINDO_RUN_URL}${run.runId}`} target="_blank" rel="noopener">
      <div className="run-header">
        <span className={classes('status-badge', run.status)}>
          {run.status === 'in_progress' && <span className="pulse" />}
          <span className="status-icon">{statusIcons[run.status]}</span>
          {statusLabels[run.status] || run.status}
        </span>
        <span className="run-time">{formatTime(run.createdAtUtc)}</span>
        <span className="run-duration">{formatDuration(run.createdAtUtc, run.endedAtUtc)}</span>
        <span className="run-link-icon">{'\u2197'}</span>
      </div>
    </a>
  ))
}

// ── Render helpers ─────────────────────────────────────────

function renderAgentCard(
  agent: Agent, runs: Run[], collapsed: boolean, models: Record<string, string>,
) {
  const activeCount = runs.filter((r) => r.status === 'in_progress').length
  const hasActive = activeCount > 0
  const modelNames = (agent.modelsInUse || []).map((id) => models[id] || id).join(', ')

  return (
    <div className={classes('agent-card', { 'has-active': hasActive })} key={agent.agentId}>
      <div className="agent-header toggle-agent" data-agentid={agent.agentId}>
        <div className="agent-info">
          <div className="agent-name-row">
            <h3 className="agent-name">{agent.name || 'Unnamed Agent'}</h3>
            {hasActive && <span className="active-badge">{activeCount} running</span>}
            {agent.hasTriggers && <span className="trigger-badge">Triggered</span>}
          </div>
          {agent.description && <p className="agent-description">{agent.description}</p>}
          <div className="agent-meta">
            {modelNames && <span className="meta-item models">{modelNames}</span>}
            <span className="meta-item last-run">Last run: {formatRelativeTime(agent.lastRunAtUtc)}</span>
            <span className="meta-item run-count">{runs.length} recent run{runs.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <span className="collapse-icon">{collapsed ? '\u25B6' : '\u25BC'}</span>
      </div>

      {!collapsed && (
        <div className="runs-list">
          {renderRunList(runs)}
        </div>
      )}
    </div>
  )
}

function getAgentHealth(runs: Run[]): 'success' | 'failure' | 'in_progress' | 'cancelled' | 'none' {
  if (runs.length === 0) return 'none'
  return runs[0].status
}

function renderCompactPanel(agent: Agent, runs: Run[]) {
  const health = getAgentHealth(runs)
  const activeCount = runs.filter((r) => r.status === 'in_progress').length
  const failCount = runs.filter((r) => r.status === 'failure').length
  const successCount = runs.filter((r) => r.status === 'success').length

  return (
    <div className={classes('compact-panel', health, 'open-modal')} key={agent.agentId} data-agentid={agent.agentId}>
      <div className="compact-status-bar">
        <span className={classes('compact-dot', health)}>
          {health === 'in_progress' ? <span className="pulse" /> : ''}
        </span>
      </div>
      <div className="compact-info">
        <div className="compact-name">{agent.name || 'Unnamed'}</div>
        <div className="compact-stats">
          {activeCount > 0 && <span className="compact-stat running">{activeCount} running</span>}
          {failCount > 0 && <span className="compact-stat failed">{failCount} failed</span>}
          {successCount > 0 && <span className="compact-stat ok">{successCount} ok</span>}
          {runs.length === 0 && <span className="compact-stat idle">No runs</span>}
        </div>
      </div>
      <div className="compact-time">{formatRelativeTime(agent.lastRunAtUtc)}</div>
    </div>
  )
}

function renderModal(agent: Agent, runs: Run[], models: Record<string, string>) {
  const modelNames = (agent.modelsInUse || []).map((id) => models[id] || id).join(', ')
  const activeCount = runs.filter((r) => r.status === 'in_progress').length

  return (
    <div className="modal-backdrop">
      <div className="modal-overlay close-modal"></div>
      <div className="modal-content">
          <div className="modal-header">
            <div>
              <div className="agent-name-row">
                <h2 className="modal-title">{agent.name || 'Unnamed Agent'}</h2>
                {activeCount > 0 && <span className="active-badge">{activeCount} running</span>}
                {agent.hasTriggers && <span className="trigger-badge">Triggered</span>}
              </div>
              {agent.description && <p className="agent-description">{agent.description}</p>}
              <div className="agent-meta">
                {modelNames && <span className="meta-item models">{modelNames}</span>}
                <span className="meta-item last-run">Last run: {formatRelativeTime(agent.lastRunAtUtc)}</span>
              </div>
            </div>
            <button className="modal-close-btn close-modal">{'\u2715'}</button>
          </div>
          <div className="modal-body">
            <div className="runs-list">
              {renderRunList(runs)}
            </div>
          </div>
      </div>
    </div>
  )
}

// ── Page component ─────────────────────────────────────────

const Page: Page = function ({ state, context }) {
  const ctx = context!
  const agents: Agent[] = ctx.agents || []
  const runs: Record<string, Run> = ctx.runs || {}
  const models: Record<string, string> = ctx.models || {}
  const loading: boolean = ctx.loading
  const error: string | null = ctx.error
  const needsSetup: boolean = ctx.needsSetup
  const activeRunCount: number = ctx.activeRunCount || 0
  const connected: boolean = ctx.connected
  const webhookLog: WebhookFireLog[] = ctx.webhookLog || []

  if (needsSetup) {
    return (
      <div className="empty-state">
        <p>Configure your API key and select agents to monitor.</p>
        <a href="/settings" className="setup-link">Go to Settings</a>
      </div>
    )
  }

  const agentCards = agents.map((agent) => {
    const agentRuns = (agent.recentRunIds || [])
      .map((id) => runs[id])
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime())
    return { agent, runs: agentRuns }
  })

  // Find modal agent
  const modalAgent = state.modalAgentId
    ? agentCards.find(({ agent }) => agent.agentId === state.modalAgentId)
    : null

  return (
    <div>
      {error && (
        <div className="error-banner">
          <span>{'\u26A0'}</span> {error}
        </div>
      )}

      {loading && agents.length === 0 && (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading agents...</p>
        </div>
      )}

      {!loading && agents.length === 0 && !error && (
        <div className="empty-state">
          <p>No data yet. Waiting for server to poll...</p>
        </div>
      )}

      <div className="dashboard-toolbar">
        <button className="refresh-btn" disabled={loading || !connected}>
          Refresh
        </button>
        <div className="view-toggle">
          <button className={classes('view-btn toggle-view', { active: !state.compactView })} title="Detailed view">
            {'\u2630'}
          </button>
          <button className={classes('view-btn toggle-view', { active: state.compactView })} title="Compact view">
            {'\u25A6'}
          </button>
        </div>
        <span className="polling-text">
          {connected
            ? `Polling every ${activeRunCount > 0 ? '10s' : '60s'}`
            : 'Not connected'}
        </span>
      </div>

      {state.compactView ? (
        <div className="compact-grid">
          {agentCards.map(({ agent, runs: agentRuns }) =>
            renderCompactPanel(agent, agentRuns)
          )}
        </div>
      ) : (
        <div className="agents-grid">
          {agentCards.map(({ agent, runs: agentRuns }) =>
            renderAgentCard(agent, agentRuns, !!(state.collapsedAgents || {})[agent.agentId], models)
          )}
        </div>
      )}

      {/* Agent detail modal (compact view) */}
      {modalAgent && renderModal(modalAgent.agent, modalAgent.runs, models)}

      {/* Webhook fire log */}
      {webhookLog.length > 0 && (
        <section className="webhook-log-section">
          <h3 className="webhook-log-title">Webhook Events</h3>
          <div className="webhook-log">
            {webhookLog.slice(-10).reverse().map(entry => (
              <div className={classes('webhook-log-item', entry.success ? 'ok' : 'fail')} key={entry.id}>
                <span className="wl-time">{formatTime(entry.timestamp)}</span>
                <span className={classes('wl-transition', entry.transition)}>
                  {entry.transition === 'failure' ? 'ALERT' : 'RECOVERED'}
                </span>
                <span className="wl-agent">{entry.agentName}</span>
                <span className="wl-webhook">{entry.webhookName}</span>
                <span className={`wl-result ${entry.success ? 'ok' : 'fail'}`}>
                  {entry.success ? entry.httpStatus : `Error`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

Page.initialState = {
  collapsedAgents: {},
  compactView: false,
  modalAgentId: null,
}

Page.intent = ({ DOM }) => ({
  INIT_VIEW: xs.of(true),
  TOGGLE_AGENT: DOM.click('.toggle-agent').data('agentid'),
  REFRESH: DOM.click('.refresh-btn'),
  TOGGLE_VIEW: DOM.click('.toggle-view'),
  OPEN_MODAL: DOM.click('.open-modal').data('agentid'),
  CLOSE_MODAL: DOM.click('.close-modal'),
})

Page.model = {
  INIT_VIEW: (state) => ({
    ...state,
    compactView: localStorage.getItem('kindo-tracker-compactView') === 'true',
  }),

  TOGGLE_AGENT: (state, agentId) => ({
    ...state,
    collapsedAgents: {
      ...state.collapsedAgents,
      [agentId]: !state.collapsedAgents[agentId],
    },
  }),

  REFRESH: {
    WS: (): WsCommand => ({ action: 'send', msg: { type: 'refresh' } }),
  },

  TOGGLE_VIEW: {
    STATE: (state) => ({ ...state, compactView: !state.compactView }),
    EFFECT: (state) => { localStorage.setItem('kindo-tracker-compactView', String(!state.compactView)) },
  },

  OPEN_MODAL: (state, agentId) => ({ ...state, modalAgentId: agentId }),

  CLOSE_MODAL: (state) => ({ ...state, modalAgentId: null }),
}

export default Page
