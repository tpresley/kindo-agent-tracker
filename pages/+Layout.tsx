import type { Component } from 'sygnal'

type Layout = Component<Record<string, never>>

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
  const path = context.urlPathname || '/'
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
              <span className={`connection-status ${context.isOffline ? 'offline' : context.connected ? 'online' : 'disconnected'}`}>
                <span className="status-dot" />
                {context.isOffline ? 'Offline' : context.connected ? 'Connected' : 'Disconnected'}
              </span>
              {context.connected && (
                <>
                  <span className="separator">{'\u00B7'}</span>
                  <span className="last-fetched">Updated: {formatLastFetched(context.lastFetchedAt)}</span>
                </>
              )}
              {context.activeRunCount > 0 && (
                <span className="active-indicator">
                  <span className="pulse" />
                  {context.activeRunCount} active
                </span>
              )}
            </div>
          </div>
        </div>
        <nav className="tab-nav">
          <a href="/" className={`tab ${isDashboard ? 'active' : ''}`}>Dashboard</a>
          <a href="/settings" className={`tab ${isSettings ? 'active' : ''}`}>Settings</a>
        </nav>
      </header>

      {children && children.length
        ? <main className="dashboard-main">{children}</main>
        : <main className="dashboard-main" props={{ innerHTML: innerHTML || '' }}></main>
      }
    </div>
  )
}

Layout.initialState = {}

export default Layout
