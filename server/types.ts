// ── Kindo API types ────────────────────────────────────────

export type AgentSummary = {
  agentId: string
  name: string
  description: string
  createdAt: string
  creatorName: string
  metadata?: { userPermissions: string[] }
}

export type Agent = AgentSummary & {
  lastRunAtUtc: string | null
  modelsInUse: string[]
  recentRunIds: string[]
  hasTriggers: boolean
  inputs: string[]
}

export type Run = {
  runId: string
  agentId: string | null
  createdAtUtc: string
  endedAtUtc: string | null
  result: string | null
  status: 'in_progress' | 'success' | 'failure' | 'cancelled'
}

export type ModelInfo = {
  id: string
  object: string
  created: number
  owned_by: string
}

// ── Webhook types ──────────────────────────────────────────

export type Webhook = {
  id: string
  name: string
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  headers: Record<string, string>
  bodyTemplate: string
  notifyOnRecovery: boolean
  enabled: boolean
}

export type WebhookPreset = 'slack' | 'generic' | 'custom'

/** Maps agentId → webhookId[]. Absent key = use default. Empty array = no webhooks. */
export type AgentWebhookMap = Record<string, string[]>

export type WebhookFireLog = {
  id: string
  webhookId: string
  webhookName: string
  agentId: string
  agentName: string
  transition: 'failure' | 'recovery'
  previousStatus: string
  newStatus: string
  httpStatus: number | null
  success: boolean
  error?: string
  timestamp: string
}

// ── WebSocket protocol ─────────────────────────────────────

export type WsClientMessage =
  | {
      type: 'configure'
      apiKey: string
      selectedAgentIds: string[]
      webhooks?: Webhook[]
      agentWebhookMap?: AgentWebhookMap
      defaultWebhookId?: string | null
      timestamps?: Record<string, string>
    }
  | { type: 'refresh' }
  | { type: 'fetchAgentList' }
  | { type: 'testWebhook'; webhook: Webhook; vars?: Record<string, string> }
  | { type: 'getSettings' }

export type SettingsSyncPayload = {
  apiKey: string
  selectedAgentIds: string[]
  webhooks: Webhook[]
  agentWebhookMap: AgentWebhookMap
  defaultWebhookId: string | null
}

export type WsServerMessage =
  | { type: 'agentData'; agents: Agent[]; runs: Record<string, Run>; totalAgents: number; fetchedAt: string; hasActiveRuns: boolean }
  | { type: 'agentList'; agents: AgentSummary[]; total: number; models: Record<string, string> }
  | { type: 'error'; message: string }
  | { type: 'webhookFired'; log: WebhookFireLog }
  | { type: 'webhookTestResult'; webhookId: string; httpStatus: number | null; success: boolean; responseBody?: string; error?: string }
  | { type: 'settingsSync'; settings: SettingsSyncPayload; overriddenKeys: string[]; timestamps: Record<string, string> }
