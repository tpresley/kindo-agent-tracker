# Kindo Agent Tracker

A real-time dashboard for monitoring [Kindo](https://kindo.ai) agent run statuses. Polls the Kindo API server-side and pushes updates to the browser via WebSocket. Includes webhook notifications for agent failure/recovery transitions, offline support, and optional authentication.

## Features

- **Live Dashboard** -- monitors selected agents with auto-refreshing run statuses (adaptive polling: 10s when agents are active, 60s otherwise)
- **Compact & Detailed Views** -- toggle between a dense status grid and full agent cards with run history
- **Agent Selection** -- choose which agents to monitor from your full Kindo account, with search and creator filters
- **Webhooks** -- configure HTTP webhooks that fire when agents transition from success to failure (and optionally on recovery). Supports customizable body templates with variable substitution. Preset templates for Slack and generic JSON.
- **Offline Support** -- cached data displayed when disconnected, settings changes queued and synced on reconnect
- **Server-Side Persistence** -- settings stored in SQLite with timestamp-based conflict resolution across clients
- **Optional Authentication** -- protect the dashboard with username/password credentials via environment variables
- **CLI Watcher** -- standalone Node.js script (`kindo-watch.mjs`) for headless agent failure monitoring with custom shell commands

## Prerequisites

- Node.js 20+
- A [Kindo](https://kindo.ai) account and API key (find yours at [app.kindo.ai/settings/api](https://app.kindo.ai/settings/api))

## Installation

```bash
git clone https://github.com/tpresley/kindo-agent-tracker.git
cd kindo-agent-tracker
npm install
```

## Running in Development

```bash
npm run dev
```

Opens the app at `http://localhost:3000`. The WebSocket server runs on port 3001 in dev mode.

### With Authentication

Set `KINDO_UN` and `KINDO_PW` environment variables to enable login:

```bash
KINDO_UN=admin KINDO_PW=yourpassword npm run dev
```

If these are not set, the dashboard is accessible without authentication.

## Production Build

```bash
npm run build
node server/index.js
```

Or with auth:

```bash
KINDO_UN=admin KINDO_PW=yourpassword PORT=3000 node server/index.js
```

## Usage

### Initial Setup

1. Open the app in your browser
2. If authentication is enabled, sign in with your credentials
3. Go to the **Settings** tab
4. Enter your Kindo API key and click **Connect**
5. Select the agents you want to monitor from the agent list
6. Switch to the **Dashboard** tab to see live run statuses

### Dashboard

- **Detailed view** (default) -- agent cards showing name, description, model, recent runs with status badges and durations
- **Compact view** -- dense grid with color-coded status dots and run counts
- **Refresh** button forces an immediate poll
- Polling interval shown in the toolbar (10s with active runs, 60s otherwise)

### Settings

**Connection** -- enter/change your Kindo API key, or disconnect

**Webhooks** -- configure HTTP endpoints that fire on agent status transitions:
- Click **+ Add Webhook** to create one
- Choose a preset (Slack, Generic JSON, or Custom)
- Set the URL, HTTP method, optional headers, and body template
- Template variables: `{{agentId}}`, `{{agentName}}`, `{{runId}}`, `{{status}}`, `{{previousStatus}}`, `{{createdAt}}`, `{{endedAt}}`, `{{duration}}`, `{{runResult}}`, `{{dashboardUrl}}`
- Enable **Notify on recovery** to also fire when an agent returns from failure to success
- Set a **Default webhook** to apply to all agents, or assign specific webhooks per agent
- Use the **Test** button to verify your webhook URL works

**Monitored Agents** -- search, filter by creator, and select which agents to track. Bulk select/deselect supported.

### CLI Watcher

A standalone script for headless monitoring that runs a shell command on agent failures:

```bash
KINDO_API_KEY="your-key" \
KINDO_ACTION="./alert.sh" \
KINDO_POLL_SECONDS=30 \
node kindo-watch.mjs agent-id-1 agent-id-2
```

| Variable | Required | Description |
|----------|----------|-------------|
| `KINDO_API_KEY` | Yes | Your Kindo API key |
| `KINDO_ACTION` | Yes | Shell command to run on each new failure |
| `KINDO_POLL_SECONDS` | No | Polling interval in seconds (default: 60) |

Arguments are Kindo agent IDs to monitor. The action command receives a JSON string with `agentId`, `name`, `runId`, `createdAtUtc`, `duration`, and `status`.

## Data Storage

- **SQLite** (`data/kindo-tracker.db`) -- server-side source of truth for settings (API key, selected agents, webhooks, webhook assignments)
- **localStorage** -- client-side cache for offline access and fast loads
- **Session cookies** -- authentication sessions (HttpOnly, SameSite=Strict)

Settings sync uses per-key timestamps for conflict resolution. If the server has newer data than the client (e.g., changed from another browser), the server's values take precedence and a notification is shown.

## Tech Stack

- [Sygnal](https://sygnal.js.org) -- reactive UI framework (Model-View-Intent architecture)
- [Vike](https://vike.dev) -- file-based routing with SSR support
- [Vite](https://vite.dev) -- build tooling
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) -- SQLite persistence
- [ws](https://github.com/websockets/ws) -- WebSocket server
- [Express](https://expressjs.com) -- production HTTP server
