import { xs, ABORT, classes } from 'sygnal'
import type { Component } from 'sygnal'
import type { AgentSummary, Webhook, WebhookPreset } from '../../server/types.js'
import {
  connectWs,
  disconnectWs,
  updateSelectedAgents,
  updateWebhookConfig,
  testWebhook as sendTestWebhook,
  saveApiKey,
  clearApiKey,
  saveSelectedAgentIds,
  saveWebhooks,
  loadWebhooks,
  saveAgentWebhookMap,
  loadAgentWebhookMap,
  saveDefaultWebhookId,
} from '../../src/ws-bridge.js'

// ── Preset templates ───────────────────────────────────────

const PRESET_TEMPLATES: Record<WebhookPreset, { bodyTemplate: string; headers: string }> = {
  slack: {
    bodyTemplate: `{"text":":rotating_light: *{{agentName}}* is now *{{status}}*\\nRun: {{runId}} | Duration: {{duration}}\\nPrevious status: {{previousStatus}}"}`,
    headers: '{}',
  },
  generic: {
    bodyTemplate: JSON.stringify({
      agentId: '{{agentId}}',
      agentName: '{{agentName}}',
      runId: '{{runId}}',
      status: '{{status}}',
      previousStatus: '{{previousStatus}}',
      createdAt: '{{createdAt}}',
      endedAt: '{{endedAt}}',
      duration: '{{duration}}',
      runResult: '{{runResult}}',
      dashboardUrl: '{{dashboardUrl}}',
    }, null, 2),
    headers: '{}',
  },
  custom: {
    bodyTemplate: '',
    headers: '{}',
  },
}

// ── Types ──────────────────────────────────────────────────

type State = {
  apiKeyInput: string
  searchQuery: string
  filterTriggers: boolean
  filterRecentRuns: boolean
  filterCreator: string
  // Webhook form
  webhookFormOpen: boolean
  editingWebhookId: string | null
  wfName: string
  wfUrl: string
  wfMethod: string
  wfHeaders: string
  wfBodyTemplate: string
  wfNotifyOnRecovery: boolean
  wfPreset: WebhookPreset
}

type Actions = {
  UPDATE_KEY_INPUT: string
  SUBMIT_KEY: Event
  DISCONNECT: Event
  UPDATE_SEARCH: string
  TOGGLE_FILTER_TRIGGERS: Event
  TOGGLE_FILTER_RECENT_RUNS: Event
  UPDATE_CREATOR_FILTER: string
  TOGGLE_AGENT: string
  SELECT_ALL_FILTERED: Event
  DESELECT_ALL: Event
  // Webhook actions
  ADD_WEBHOOK: Event
  EDIT_WEBHOOK: string
  DELETE_WEBHOOK: string
  TOGGLE_WEBHOOK_ENABLED: string
  TEST_WEBHOOK: string
  UPDATE_DEFAULT_WEBHOOK: string
  UPDATE_AGENT_WEBHOOK: Event
  // Webhook form
  WF_NAME: string
  WF_URL: string
  WF_METHOD: string
  WF_HEADERS: string
  WF_BODY: string
  WF_RECOVERY: Event
  WF_PRESET: string
  WF_SAVE: Event
  WF_CANCEL: Event
}

type Page = Component<State, {}, Actions>

// ── Helpers ────────────────────────────────────────────────

function getCreators(agents: AgentSummary[]): string[] {
  const set = new Set<string>()
  for (const a of agents) if (a.creatorName) set.add(a.creatorName)
  return Array.from(set).sort()
}

function filterAgents(agents: AgentSummary[], search: string, filterCreator: string): AgentSummary[] {
  let result = agents
  if (search) {
    const q = search.toLowerCase()
    result = result.filter(a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
  }
  if (filterCreator) {
    result = result.filter(a => a.creatorName === filterCreator)
  }
  return result
}

function emptyFormState(): Partial<State> {
  return {
    webhookFormOpen: true,
    editingWebhookId: null,
    wfName: '',
    wfUrl: '',
    wfMethod: 'POST',
    wfHeaders: '{}',
    wfBodyTemplate: PRESET_TEMPLATES.generic.bodyTemplate,
    wfNotifyOnRecovery: true,
    wfPreset: 'generic' as WebhookPreset,
  }
}

// ── Page component ─────────────────────────────────────────

const Page: Page = function ({ state, context }) {
  const apiKey: string = context.apiKey || ''
  const connected: boolean = context.connected
  const allAgents: AgentSummary[] = context.allAgents || []
  const selectedIds: string[] = context.selectedAgentIds || []
  const webhooks: Webhook[] = context.webhooks || []
  const agentWebhookMap: Record<string, string[]> = context.agentWebhookMap || {}
  const defaultWebhookId: string | null = context.defaultWebhookId
  const testResults: Record<string, any> = context.webhookTestResults || {}
  const isOffline: boolean = context.isOffline
  const error: string | null = context.error
  const isConfigured = !!apiKey

  const creators = getCreators(allAgents)
  const filtered = filterAgents(allAgents, state.searchQuery, state.filterCreator)
  const selectedSet = new Set(selectedIds)

  return (
    <div className="settings-page">
      {/* ── Connection Section ────────────────────────── */}
      <section className="settings-section">
        <h2>Connection</h2>
        {isConfigured ? (
          <div className="connection-card connected-card">
            <div className="connection-info">
              <span className={`connection-status ${connected ? 'online' : 'disconnected'}`}>
                <span className="status-dot" />
                {connected ? 'Connected' : 'Disconnected'}
              </span>
              <span className="api-key-masked">Key: {'*'.repeat(8)}...{apiKey.slice(-6)}</span>
            </div>
            <button className="disconnect-btn">Disconnect</button>
          </div>
        ) : (
          <div className="connection-card">
            <div className="setup-form">
              <label className="input-label" attrs={{ for: 'api-key' }}>API Key</label>
              <input type="password" id="api-key" className="api-key-input" placeholder="Enter your Kindo API key..." value={state.apiKeyInput} />
              <p className="input-hint">
                Find your API key at{' '}
                <a href="https://app.kindo.ai/settings/api" target="_blank" rel="noopener">app.kindo.ai/settings/api</a>
              </p>
              <button className="submit-key-btn" attrs={{ disabled: !state.apiKeyInput.trim() || isOffline }}>Connect</button>
            </div>
          </div>
        )}
        {error && <div className="error-message">{error}</div>}
      </section>

      {/* ── Webhooks Section ─────────────────────────── */}
      {isConfigured && (
        <section className="settings-section">
          <div className="section-header">
            <h2>Webhooks</h2>
            <button className="add-webhook-btn">+ Add Webhook</button>
          </div>

          {/* Default webhook selector */}
          {webhooks.length > 0 && (
            <div className="default-webhook-row">
              <label className="input-label">Default webhook</label>
              <select className="default-webhook-select" value={defaultWebhookId || ''}>
                <option value="">None</option>
                {webhooks.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <span className="input-hint">Applied to all monitored agents unless overridden</span>
            </div>
          )}

          {/* Webhook list */}
          {webhooks.length > 0 && (
            <div className="webhook-list">
              {webhooks.map(webhook => (
                <div className={classes('webhook-item', { disabled: !webhook.enabled })} key={webhook.id}>
                  <div className="webhook-item-info">
                    <span className={`webhook-status-dot ${webhook.enabled ? 'active' : ''}`} />
                    <span className="webhook-item-name">{webhook.name}</span>
                    <span className="webhook-item-url">{webhook.url}</span>
                    <span className="webhook-item-method">{webhook.method}</span>
                    {webhook.notifyOnRecovery && <span className="webhook-recovery-badge">+recovery</span>}
                  </div>
                  <div className="webhook-item-actions">
                    <button className="wh-action-btn webhook-test-btn" attrs={{ 'data-webhookid': webhook.id }}>Test</button>
                    <button className="wh-action-btn webhook-edit-btn" attrs={{ 'data-webhookid': webhook.id }}>Edit</button>
                    <button className="wh-action-btn webhook-toggle-btn" attrs={{ 'data-webhookid': webhook.id }}>
                      {webhook.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button className="wh-action-btn webhook-delete-btn danger" attrs={{ 'data-webhookid': webhook.id }}>Delete</button>
                  </div>
                  {testResults[webhook.id] && (
                    <div className={`webhook-test-result ${testResults[webhook.id].success ? 'ok' : 'fail'}`}>
                      {testResults[webhook.id].success
                        ? `OK (${testResults[webhook.id].httpStatus})`
                        : `Failed: ${testResults[webhook.id].error || testResults[webhook.id].httpStatus}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {webhooks.length === 0 && !state.webhookFormOpen && (
            <p className="input-hint">No webhooks configured. Add one to get notified on agent failures.</p>
          )}

          {/* Inline create/edit form */}
          {state.webhookFormOpen && (
            <div className="webhook-form">
              <h3>{state.editingWebhookId ? 'Edit Webhook' : 'New Webhook'}</h3>
              <div className="webhook-form-row">
                <label className="input-label">Name</label>
                <input className="wf-name wf-input" value={state.wfName} placeholder="e.g. Slack #alerts" />
              </div>
              <div className="webhook-form-row">
                <label className="input-label">Preset</label>
                <select className="wf-preset wf-select" value={state.wfPreset}>
                  <option value="generic">Generic JSON</option>
                  <option value="slack">Slack</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="webhook-form-row">
                <label className="input-label">URL</label>
                <input className="wf-url wf-input" value={state.wfUrl} placeholder="https://hooks.slack.com/..." />
              </div>
              <div className="webhook-form-row">
                <label className="input-label">Method</label>
                <select className="wf-method wf-select" value={state.wfMethod}>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div className="webhook-form-row">
                <label className="input-label">Headers (JSON)</label>
                <textarea className="wf-headers webhook-textarea" value={state.wfHeaders} attrs={{ rows: '2' }} />
              </div>
              <div className="webhook-form-row">
                <label className="input-label">Body Template</label>
                <textarea className="wf-body webhook-textarea" value={state.wfBodyTemplate} attrs={{ rows: '6' }} />
                <p className="input-hint">
                  Variables: {'{{agentId}}'}, {'{{agentName}}'}, {'{{runId}}'}, {'{{status}}'}, {'{{previousStatus}}'}, {'{{createdAt}}'}, {'{{endedAt}}'}, {'{{duration}}'}, {'{{runResult}}'}, {'{{dashboardUrl}}'}
                </p>
              </div>
              <div className="webhook-form-row">
                <label className="webhook-checkbox-label">
                  <input type="checkbox" className="wf-recovery" attrs={{ checked: state.wfNotifyOnRecovery ? '' : undefined }} />
                  Notify on recovery (failure {'\u2192'} success)
                </label>
              </div>
              <div className="webhook-form-actions">
                <button className="submit-key-btn wf-save-btn" attrs={{ disabled: !state.wfName.trim() || !state.wfUrl.trim() }}>
                  {state.editingWebhookId ? 'Update' : 'Create'}
                </button>
                <button className="disconnect-btn wf-cancel-btn">Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Monitored Agents Section ─────────────────── */}
      {isConfigured && (
        <section className="settings-section">
          <div className="section-header">
            <h2>Monitored Agents</h2>
            <span className="selection-count">{selectedIds.length} selected{allAgents.length > 0 && ` of ${allAgents.length}`}</span>
          </div>

          {allAgents.length === 0 && connected && (
            <div className="loading-state"><div className="spinner" /><p>Loading agent list...</p></div>
          )}

          {allAgents.length > 0 && (
            <>
              <div className="filter-bar">
                <input type="text" className="search-input" placeholder="Search agents..." value={state.searchQuery} />
                <select className="creator-filter" value={state.filterCreator}>
                  <option value="">All creators</option>
                  {creators.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="bulk-actions">
                  <button className="select-all-btn">Select filtered</button>
                  <button className="deselect-all-btn">Deselect all</button>
                </div>
              </div>

              <div className="agent-picker">
                {filtered.map(agent => {
                  const isSelected = selectedSet.has(agent.agentId)
                  const agentWh = agentWebhookMap[agent.agentId]
                  const whValue = agentWh === undefined ? 'default' : (agentWh.length === 0 ? 'none' : agentWh[0])
                  return (
                    <div key={agent.agentId} className={classes('agent-picker-item', { selected: isSelected })}>
                      <button className="agent-toggle-btn" attrs={{ 'data-agentid': agent.agentId }}>
                        <span className={`checkbox ${isSelected ? 'checked' : ''}`}>{isSelected ? '\u2713' : ''}</span>
                      </button>
                      <div className="agent-picker-info">
                        <div className="agent-picker-name">{agent.name}</div>
                        {agent.description && <div className="agent-picker-desc">{agent.description}</div>}
                        <div className="agent-picker-meta">
                          <span className="meta-creator">{agent.creatorName}</span>
                        </div>
                      </div>
                      {webhooks.length > 0 && isSelected && (
                        <select className="agent-webhook-select" attrs={{ 'data-agentid': agent.agentId }} value={whValue}>
                          <option value="default">Default</option>
                          <option value="none">No webhook</option>
                          {webhooks.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      )}
                    </div>
                  )
                })}
                {filtered.length === 0 && <div className="no-agents">No agents match your filters</div>}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

Page.initialState = {
  apiKeyInput: '',
  searchQuery: '',
  filterTriggers: false,
  filterRecentRuns: false,
  filterCreator: '',
  webhookFormOpen: false,
  editingWebhookId: null,
  wfName: '',
  wfUrl: '',
  wfMethod: 'POST',
  wfHeaders: '{}',
  wfBodyTemplate: PRESET_TEMPLATES.generic.bodyTemplate,
  wfNotifyOnRecovery: true,
  wfPreset: 'generic' as WebhookPreset,
}

Page.intent = ({ DOM }) => ({
  UPDATE_KEY_INPUT:         DOM.input('.api-key-input').value(),
  SUBMIT_KEY:               xs.merge(DOM.click('.submit-key-btn'), DOM.keydown('.api-key-input').key().filter((k: string) => k === 'Enter')),
  DISCONNECT:               DOM.click('.disconnect-btn'),
  UPDATE_SEARCH:            DOM.input('.search-input').value(),
  TOGGLE_FILTER_TRIGGERS:   DOM.click('.filter-triggers'),
  TOGGLE_FILTER_RECENT_RUNS: DOM.click('.filter-recent-runs'),
  UPDATE_CREATOR_FILTER:    DOM.input('.creator-filter').value(),
  TOGGLE_AGENT:             DOM.click('.agent-toggle-btn').data('agentid'),
  SELECT_ALL_FILTERED:      DOM.click('.select-all-btn'),
  DESELECT_ALL:             DOM.click('.deselect-all-btn'),
  // Webhook actions
  ADD_WEBHOOK:              DOM.click('.add-webhook-btn'),
  EDIT_WEBHOOK:             DOM.click('.webhook-edit-btn').data('webhookid'),
  DELETE_WEBHOOK:            DOM.click('.webhook-delete-btn').data('webhookid'),
  TOGGLE_WEBHOOK_ENABLED:   DOM.click('.webhook-toggle-btn').data('webhookid'),
  TEST_WEBHOOK:             DOM.click('.webhook-test-btn').data('webhookid'),
  UPDATE_DEFAULT_WEBHOOK:   DOM.input('.default-webhook-select').value(),
  UPDATE_AGENT_WEBHOOK:     DOM.input('.agent-webhook-select'),
  // Webhook form
  WF_NAME:                  DOM.input('.wf-name').value(),
  WF_URL:                   DOM.input('.wf-url').value(),
  WF_METHOD:                DOM.input('.wf-method').value(),
  WF_HEADERS:               DOM.input('.wf-headers').value(),
  WF_BODY:                  DOM.input('.wf-body').value(),
  WF_RECOVERY:              DOM.click('.wf-recovery'),
  WF_PRESET:                DOM.input('.wf-preset').value(),
  WF_SAVE:                  DOM.click('.wf-save-btn'),
  WF_CANCEL:                DOM.click('.wf-cancel-btn'),
})

Page.model = {
  UPDATE_KEY_INPUT: (state, value) => ({ ...state, apiKeyInput: value }),

  SUBMIT_KEY: {
    STATE: (state) => {
      if (!state.apiKeyInput.trim()) return ABORT
      return { ...state, apiKeyInput: '' }
    },
    EFFECT: (state) => {
      const key = state.apiKeyInput.trim()
      if (!key) return
      saveApiKey(key)
      const ids = JSON.parse(localStorage.getItem('kindo-tracker-selectedAgents') || '[]')
      connectWs(key, ids)
    },
  },

  DISCONNECT: {
    EFFECT: () => {
      clearApiKey()
      disconnectWs()
      window.location.href = '/settings'
    },
  },

  UPDATE_SEARCH: (state, value) => ({ ...state, searchQuery: value }),
  TOGGLE_FILTER_TRIGGERS: (state) => ({ ...state, filterTriggers: !state.filterTriggers }),
  TOGGLE_FILTER_RECENT_RUNS: (state) => ({ ...state, filterRecentRuns: !state.filterRecentRuns }),
  UPDATE_CREATOR_FILTER: (state, value) => ({ ...state, filterCreator: value }),

  TOGGLE_AGENT: {
    EFFECT: (_state, agentId, _next, { context }) => {
      const current: string[] = context.selectedAgentIds || []
      const updated = current.includes(agentId) ? current.filter((id: string) => id !== agentId) : [...current, agentId]
      saveSelectedAgentIds(updated)
      updateSelectedAgents(updated)
    },
  },

  SELECT_ALL_FILTERED: {
    EFFECT: (state, _data, _next, { context }) => {
      const allAgents: AgentSummary[] = context.allAgents || []
      const current: string[] = context.selectedAgentIds || []
      const filtered = filterAgents(allAgents, state.searchQuery, state.filterCreator)
      const merged = new Set([...current, ...filtered.map(a => a.agentId)])
      const updated = Array.from(merged)
      saveSelectedAgentIds(updated)
      updateSelectedAgents(updated)
    },
  },

  DESELECT_ALL: {
    EFFECT: () => {
      saveSelectedAgentIds([])
      updateSelectedAgents([])
    },
  },

  // ── Webhook CRUD ─────────────────────────────────

  ADD_WEBHOOK: (state) => ({ ...state, ...emptyFormState() }),

  EDIT_WEBHOOK: (state, webhookId, _next, { context }) => {
    const wh = (context.webhooks as Webhook[])?.find(w => w.id === webhookId)
    if (!wh) return state
    return {
      ...state,
      webhookFormOpen: true,
      editingWebhookId: webhookId,
      wfName: wh.name,
      wfUrl: wh.url,
      wfMethod: wh.method,
      wfHeaders: JSON.stringify(wh.headers, null, 2),
      wfBodyTemplate: wh.bodyTemplate,
      wfNotifyOnRecovery: wh.notifyOnRecovery,
      wfPreset: 'custom' as WebhookPreset,
    }
  },

  DELETE_WEBHOOK: {
    EFFECT: (_state, webhookId, _next, { context }) => {
      const current = (context.webhooks as Webhook[]) || []
      const updated = current.filter(w => w.id !== webhookId)
      saveWebhooks(updated)
      // Clean from agent map
      const map = loadAgentWebhookMap()
      for (const agentId of Object.keys(map)) {
        map[agentId] = map[agentId].filter(id => id !== webhookId)
      }
      saveAgentWebhookMap(map)
      // Clear default if it matches
      if (context.defaultWebhookId === webhookId) {
        saveDefaultWebhookId(null)
      }
      updateWebhookConfig()
    },
  },

  TOGGLE_WEBHOOK_ENABLED: {
    EFFECT: (_state, webhookId) => {
      const webhooks = loadWebhooks()
      const idx = webhooks.findIndex(w => w.id === webhookId)
      if (idx >= 0) {
        webhooks[idx].enabled = !webhooks[idx].enabled
        saveWebhooks(webhooks)
        updateWebhookConfig()
      }
    },
  },

  TEST_WEBHOOK: {
    EFFECT: (_state, webhookId, _next, { context }) => {
      const wh = (context.webhooks as Webhook[])?.find(w => w.id === webhookId)
      if (wh) sendTestWebhook(wh)
    },
  },

  UPDATE_DEFAULT_WEBHOOK: {
    EFFECT: (_state, value) => {
      saveDefaultWebhookId(value || null)
      updateWebhookConfig()
    },
  },

  UPDATE_AGENT_WEBHOOK: {
    EFFECT: (_state, event) => {
      const target = event?.target as HTMLSelectElement | undefined
      if (!target) return
      const agentId = target.dataset?.agentid || target.getAttribute('data-agentid')
      const value = target.value
      if (!agentId) return
      const map = loadAgentWebhookMap()
      if (value === 'default') {
        delete map[agentId]
      } else if (value === 'none') {
        map[agentId] = []
      } else {
        map[agentId] = [value]
      }
      saveAgentWebhookMap(map)
      updateWebhookConfig()
    },
  },

  // ── Webhook form ─────────────────────────────────

  WF_NAME: (state, value) => ({ ...state, wfName: value }),
  WF_URL: (state, value) => ({ ...state, wfUrl: value }),
  WF_METHOD: (state, value) => ({ ...state, wfMethod: value }),
  WF_HEADERS: (state, value) => ({ ...state, wfHeaders: value }),
  WF_BODY: (state, value) => ({ ...state, wfBodyTemplate: value }),
  WF_RECOVERY: (state) => ({ ...state, wfNotifyOnRecovery: !state.wfNotifyOnRecovery }),

  WF_PRESET: (state, value) => {
    const preset = value as WebhookPreset
    const tpl = PRESET_TEMPLATES[preset] || PRESET_TEMPLATES.custom
    return { ...state, wfPreset: preset, wfBodyTemplate: tpl.bodyTemplate, wfHeaders: tpl.headers }
  },

  WF_SAVE: {
    STATE: (state) => {
      if (!state.wfName.trim() || !state.wfUrl.trim()) return ABORT
      return { ...state, webhookFormOpen: false }
    },
    EFFECT: (state) => {
      if (!state.wfName.trim() || !state.wfUrl.trim()) return
      let headers: Record<string, string> = {}
      try { headers = JSON.parse(state.wfHeaders) } catch { /* keep empty */ }

      const webhook: Webhook = {
        id: state.editingWebhookId || crypto.randomUUID(),
        name: state.wfName.trim(),
        url: state.wfUrl.trim(),
        method: (state.wfMethod as Webhook['method']) || 'POST',
        headers,
        bodyTemplate: state.wfBodyTemplate,
        notifyOnRecovery: state.wfNotifyOnRecovery,
        enabled: true,
      }

      const webhooks = loadWebhooks()
      const idx = webhooks.findIndex(w => w.id === webhook.id)
      if (idx >= 0) {
        webhooks[idx] = webhook
      } else {
        webhooks.push(webhook)
      }
      saveWebhooks(webhooks)
      updateWebhookConfig()
    },
  },

  WF_CANCEL: (state) => ({ ...state, webhookFormOpen: false }),
}

export default Page
