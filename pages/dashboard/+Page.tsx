import { classes } from 'sygnal'
import type { Component } from 'sygnal'
import type { Agent, Run, WebhookFireLog } from '../../server/types.js'
import { sendWs } from '../../src/ws-bridge.js'

type State = {
  collapsedAgents: Record<string, boolean>
  compactView: boolean
}

type Actions = {
  TOGGLE_AGENT: string
  REFRESH: Event
  TOGGLE_VIEW: Event
}

type Page = Component<State, {}, Actions>

// ── Formatting helpers ─────────────────────────────────────

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
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'running...'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return '<1s'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

const statusLabels: Record<string, string> = {
  in_progress: 'Running', success: 'Success', failure: 'Failed', cancelled: 'Cancelled',
}

const statusIcons: Record<string, string> = {
  in_progress: '\u25CF', success: '\u2713', failure: '\u2717', cancelled: '\u2014',
}

// ── Render helpers ─────────────────────────────────────────

function renderAgentCard(
  agent: Agent,
  runs: Run[],
  collapsed: boolean,
  models: Record<string, string>,
) {
  const activeCount = runs.filter((r) => r.status === 'in_progress').length
  const hasActive = activeCount > 0

  const modelNames = (agent.modelsInUse || [])
    .map((id) => models[id] || id)
    .join(', ')

  return (
    <div className={classes('agent-card', { 'has-active': hasActive })} key={agent.agentId}>
      <div className="agent-header toggle-agent" attrs={{ 'data-agentid': agent.agentId }}>
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
          {runs.length === 0 ? (
            <div className="no-runs">No recent runs</div>
          ) : (
            runs.map((run) => (
              <div key={run.runId} className={classes('run-item', run.status)}>
                <div className="run-header">
                  <span className={classes('status-badge', run.status)}>
                    {run.status === 'in_progress' && <span className="pulse" />}
                    <span className="status-icon">{statusIcons[run.status]}</span>
                    {statusLabels[run.status] || run.status}
                  </span>
                  <span className="run-time">{formatTime(run.createdAtUtc)}</span>
                  <span className="run-duration">{formatDuration(run.createdAtUtc, run.endedAtUtc)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Determine the overall health status for an agent based on its most recent run. */
function getAgentHealth(runs: Run[]): 'success' | 'failure' | 'in_progress' | 'cancelled' | 'none' {
  if (runs.length === 0) return 'none'
  return runs[0].status
}

function renderCompactPanel(
  agent: Agent,
  runs: Run[],
) {
  const health = getAgentHealth(runs)
  const activeCount = runs.filter((r) => r.status === 'in_progress').length
  const failCount = runs.filter((r) => r.status === 'failure').length
  const successCount = runs.filter((r) => r.status === 'success').length

  return (
    <div className={classes('compact-panel', health)} key={agent.agentId}>
      <div className="compact-status-bar">
        <span className={classes('compact-dot', health)}>
          {health === 'in_progress' && <span className="pulse" />}
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

// ── Page component ─────────────────────────────────────────

const Page: Page = function ({ state, context }) {
  const agents: Agent[] = context.agents || []
  const runs: Record<string, Run> = context.runs || {}
  const models: Record<string, string> = context.models || {}
  const loading: boolean = context.loading
  const error: string | null = context.error
  const needsSetup: boolean = context.needsSetup
  const activeRunCount: number = context.activeRunCount || 0
  const connected: boolean = context.connected
  const webhookLog: WebhookFireLog[] = context.webhookLog || []

  if (needsSetup) {
    return (
      <div className="empty-state">
        <p>Configure your API key and select agents to monitor.</p>
        <a href="/settings" className="setup-link">Go to Settings</a>
      </div>
    )
  }

  // Build agent cards with their runs inline
  const agentCards = agents.map((agent) => {
    const agentRuns = (agent.recentRunIds || [])
      .map((id) => runs[id])
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime())
    return { agent, runs: agentRuns }
  })

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
        <button className="refresh-btn" attrs={{ disabled: loading || !connected }}>
          Refresh
        </button>
        <div className="view-toggle">
          <button className={classes('view-btn toggle-view', { active: !state.compactView })} attrs={{ title: 'Detailed view' }}>
            {'\u2630'}
          </button>
          <button className={classes('view-btn toggle-view', { active: state.compactView })} attrs={{ title: 'Compact view' }}>
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
            renderAgentCard(agent, agentRuns, !!state.collapsedAgents[agent.agentId], models)
          )}
        </div>
      )}

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
}

Page.intent = ({ DOM }) => ({
  TOGGLE_AGENT: DOM.click('.toggle-agent').data('agentid'),
  REFRESH: DOM.click('.refresh-btn'),
  TOGGLE_VIEW: DOM.click('.toggle-view'),
})

Page.model = {
  TOGGLE_AGENT: (state, agentId) => ({
    ...state,
    collapsedAgents: {
      ...state.collapsedAgents,
      [agentId]: !state.collapsedAgents[agentId],
    },
  }),

  REFRESH: {
    EFFECT: () => {
      sendWs({ type: 'refresh' })
    },
  },

  TOGGLE_VIEW: (state) => ({
    ...state,
    compactView: !state.compactView,
  }),
}

export default Page
