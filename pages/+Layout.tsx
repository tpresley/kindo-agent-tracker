import type { Component } from 'sygnal'
import type { AppDrivers, AppContext, VikeShellProps } from '../src/types.js'

type State = Record<string, never>
type Actions = { LOGOUT_CLICK: Event }
type Layout = Component<State, VikeShellProps, AppDrivers, Actions, {}, AppContext>

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

const Layout: Layout = function ({ state, context, children, innerHTML }) {
  const ctx = context!
  const path = ctx.urlPathname || '/'
  const isSettings = path === '/settings'
  const isDashboard = !isSettings

  return (
    <div className="layout">
      <header className="dashboard-header">
        <div className="header-left">
          <img src="/favicon.svg" alt="Kindo" className="header-logo" />
          <div>
            <h1 className="header-title">Kindo Agent Tracker</h1>
            <div className="header-meta">
              <span className={`connection-status ${ctx.isOffline ? 'offline' : ctx.connected ? 'online' : 'disconnected'}`}>
                <span className="status-dot" />
                <span className="label-text">{ctx.isOffline ? 'Offline' : ctx.connected ? 'Connected' : 'Disconnected'}</span>
              </span>
              {ctx.connected && (
                <>
                  <span className="separator">{'\u00B7'}</span>
                  <span className="last-fetched">{formatLastFetched(ctx.lastFetchedAt)}</span>
                </>
              )}
              {ctx.activeRunCount > 0 && (
                <span className="active-indicator">
                  <span className="pulse" />
                  <span className="label-text">{ctx.activeRunCount} active</span>
                  <span className="label-icon">{ctx.activeRunCount}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="header-right">
          <nav className="tab-nav">
            <a href="/" className={`tab ${isDashboard ? 'active' : ''}`} title="Dashboard">
              <span className="tab-icon">{'\u2630'}</span>
              <span className="tab-label">Dashboard</span>
            </a>
            <a href="/settings" className={`tab ${isSettings ? 'active' : ''}`} title="Settings">
              <span className="tab-icon">{'\u2699'}</span>
              <span className="tab-label">Settings</span>
            </a>
          </nav>
          {ctx.authEnabled && (
            <button className="layout-logout-btn logout-btn" title="Logout">
              <span className="tab-icon">{'\u2190'}</span>
              <span className="tab-label">Logout</span>
            </button>
          )}
        </div>
      </header>

      {children && (children as any[]).length
        ? <main className="dashboard-main">{children}</main>
        : <main className="dashboard-main" props={{ innerHTML: innerHTML || '' }}></main>
      }
    </div>
  )
}

Layout.initialState = {} as State

Layout.intent = ({ DOM }) => ({
  LOGOUT_CLICK: DOM.click('.layout-logout-btn'),
})

Layout.model = {
  LOGOUT_CLICK: {
    EVENTS: (): { type: string; data: any } => ({ type: 'LOGOUT', data: null }),
  },
}

export default Layout
