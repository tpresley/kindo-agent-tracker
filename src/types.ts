/**
 * Shared client-side types for the Kindo Agent Tracker.
 */
import type { Agent, Run, AgentSummary, Webhook, AgentWebhookMap, WebhookFireLog } from '../server/types.js'
import type { WsSource, WsCommand } from './drivers/ws.js'
import type { HttpSource, HttpRequest } from './drivers/http.js'

/** Custom drivers registered in +drivers.ts */
export type AppDrivers = {
  WS: { source: WsSource; sink: WsCommand }
  HTTP: { source: HttpSource; sink: HttpRequest }
}

/** Context shape exposed by the Wrapper to Layout and Page components.
 *  Includes Vike-injected fields (urlPathname, routeParams, pageData). */
export type AppContext = {
  // Vike-injected context
  urlPathname: string
  routeParams: Record<string, string>
  pageData: any
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
  activeRunCount: number
  needsSetup: boolean
  webhooks: Webhook[]
  agentWebhookMap: AgentWebhookMap
  defaultWebhookId: string | null
  webhookLog: WebhookFireLog[]
  webhookTestResults: Record<string, { success: boolean; httpStatus: number | null; error?: string }>
  authEnabled: boolean
}

/** Props for Vike shell components (Wrapper/Layout) that receive innerHTML during SSR. */
export type VikeShellProps = {
  innerHTML?: string
}
