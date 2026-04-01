#!/usr/bin/env node

import { execSync } from 'node:child_process'

// ── Configuration ──────────────────────────────────────────
const API_KEY = process.env.KINDO_API_KEY
const ACTION = process.env.KINDO_ACTION
const POLL_SECONDS = parseInt(process.env.KINDO_POLL_SECONDS || '60', 10)
const API_BASE = 'https://api.kindo.ai/v1'

// ── Validate inputs ────────────────────────────────────────
if (!API_KEY) {
  console.error('Error: KINDO_API_KEY environment variable is required')
  process.exit(1)
}
if (!ACTION) {
  console.error('Error: KINDO_ACTION environment variable is required')
  process.exit(1)
}

const agentIds = process.argv.slice(2)
if (agentIds.length === 0) {
  console.error(`Usage: KINDO_API_KEY=<key> KINDO_ACTION=<command> ${process.argv[1]} <agent-id> [agent-id ...]`)
  console.error('')
  console.error('Environment variables:')
  console.error('  KINDO_API_KEY       (required) Your Kindo API key')
  console.error('  KINDO_ACTION        (required) Shell command to run on each new failure')
  console.error('  KINDO_POLL_SECONDS  (optional) Polling interval in seconds (default: 60)')
  process.exit(1)
}

// ── State ──────────────────────────────────────────────────
const baselineRunIds = new Set()
const seenFailures = new Set()
const agentNames = new Map()

// ── Helpers ────────────────────────────────────────────────
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-api-key': API_KEY },
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

function formatDuration(startIso, endIso) {
  if (!endIso) return 'running...'
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Phase 1: Baseline ──────────────────────────────────────
console.log('Initializing Kindo agent watcher...')
console.log(`  Agents:   ${agentIds.length}`)
console.log(`  Interval: ${POLL_SECONDS}s`)
console.log('')

for (const agentId of agentIds) {
  let agent
  try {
    agent = await apiGet(`/agents/${agentId}`)
  } catch (err) {
    console.error(`Error: Failed to fetch agent ${agentId}: ${err.message}`)
    process.exit(1)
  }

  const name = agent.name || 'Unknown'
  agentNames.set(agentId, name)

  const runIds = agent.recentRunIds || []
  for (const rid of runIds) {
    baselineRunIds.add(rid)
  }

  console.log(`  [baseline] ${name} (${agentId}) — ${runIds.length} existing runs recorded`)
}

console.log('')
console.log('Baseline established. Watching for new failures...')
console.log('────────────────────────────────────────────────────')

// ── Phase 2: Poll loop ─────────────────────────────────────
while (true) {
  await sleep(POLL_SECONDS * 1000)

  for (const agentId of agentIds) {
    let agent
    try {
      agent = await apiGet(`/agents/${agentId}`)
    } catch (err) {
      console.error(`[${timestamp()}] Warning: Failed to fetch agent ${agentId}, will retry`)
      continue
    }

    const name = agent.name || 'Unknown'
    agentNames.set(agentId, name)

    const runIds = agent.recentRunIds || []

    for (const runId of runIds) {
      // Skip baseline runs
      if (baselineRunIds.has(runId)) continue

      // Skip already-processed failures
      if (seenFailures.has(runId)) continue

      // Fetch run details
      let run
      try {
        run = await apiGet(`/runs/${runId}`)
      } catch {
        continue
      }

      // Only act on failures
      if (run.status !== 'failure') continue

      // Mark as seen to prevent duplicates
      seenFailures.add(runId)

      const duration = formatDuration(run.createdAtUtc, run.endedAtUtc)

      const payload = JSON.stringify({
        agentId,
        name,
        runId: run.runId,
        createdAtUtc: run.createdAtUtc,
        duration,
        status: run.status,
      })

      console.log(`[${timestamp()}] FAILURE detected: ${name} (run ${runId})`)
      console.log(`  Duration: ${duration}`)
      console.log(`  Executing: ${ACTION}`)

      // Run the action — exit if it fails
      try {
        execSync(`${ACTION} ${JSON.stringify(payload)}`, { stdio: 'inherit' })
      } catch (err) {
        console.error(`Error: KINDO_ACTION command failed with exit code ${err.status}`)
        process.exit(1)
      }

      console.log('')
    }
  }
}
