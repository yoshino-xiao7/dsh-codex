export declare const CHANNEL: "/dsh-codex"
export declare const DIAGNOSTICS_CHANNEL: "/dsh-codex-diagnostics"
export declare const CODEX_PROVIDER: "dsh-codex"
export declare const NS: "settings.codex"
export declare const inject: readonly ["slots", "locale", "connection", "settingsScope"]

export interface AuthorizationNotice {
  message: string
  url?: string
  code?: string
}

export type AuthorizationPrompt =
  | { kind: "text" | "secret"; message: string; placeholder?: string }
  | {
      kind: "select"
      message: string
      options: readonly { id: string; label: string; description?: string }[]
    }

export type AuthorizationEvent =
  | { seq: number; type: "notice"; notice: AuthorizationNotice }
  | { seq: number; type: "prompt"; promptId: string; prompt: AuthorizationPrompt }
  | { seq: number; type: "prompt-closed"; promptId: string }
  | { seq: number; type: "settled"; status: "authorized" | "cancelled" }
  | { seq: number; type: "failed"; error: { code: string; message: string } }

export interface AuthorizationStatus {
  flow?: {
    key: "dsh-codex/openai-codex"
    label: string
    methods: readonly { id: string; label: string }[]
    inFlight: boolean
  }
  credential: {
    configured: boolean
    state: "signed-in" | "signed-out" | "invalid"
    kind?: string
    writable: boolean
  }
  quota:
    | { readonly status: "unknown" }
    | { readonly status: "recent-success"; readonly observedAt: number }
    | {
        readonly status: "exhausted"
        readonly observedAt: number
        readonly resetAt?: number
      }
}

export interface CodexUsageWindow {
  usedPercent: number
  windowDurationMins: number
  resetsAt: number
}

export interface CodexUsageRateLimit {
  limitId: string
  limitName?: string
  primary?: CodexUsageWindow
  secondary?: CodexUsageWindow
}

export interface CodexAccountUsage {
  observedAt: number
  planType?: string
  rateLimits: readonly CodexUsageRateLimit[]
}

export interface CodexAccountUsageReminder {
  readonly kind: "low" | "exhausted"
  readonly windowDurationMins: 300 | 10_080
  readonly remainingPercent: number
  readonly resetsAt: number
}

export type CodexPassiveDiagnosticMode = "local" | "account"
export type CodexDiagnosticMode = CodexPassiveDiagnosticMode | "network"
export type CodexDiagnosticOutcome = "pass" | "warning" | "fail" | "cancelled"
export type CodexDiagnosticStatus = "pass" | "warning" | "fail" | "skipped"

export interface CodexDiagnosticCheck {
  readonly id: string
  readonly status: CodexDiagnosticStatus
  readonly code: string
  readonly facts?: Readonly<Record<string, boolean | number | string>>
}

export interface CodexDiagnosticsReport {
  readonly version: 2
  readonly mode: CodexDiagnosticMode
  readonly outcome: CodexDiagnosticOutcome
  readonly observedAt: number
  readonly checks: readonly CodexDiagnosticCheck[]
}

export interface CodexNetworkDiagnosticConsent {
  readonly version: 1
  readonly consentId: string
  readonly expiresAt: number
  readonly modelId: string
  readonly transport: "sse"
}

export interface CodexDiagnosticsHistory {
  readonly version: 1
  readonly limit: number
  readonly reports: readonly CodexDiagnosticsReport[]
}

export interface ConnectionDiagnosticsClient {
  run(mode: CodexPassiveDiagnosticMode, signal?: AbortSignal): Promise<CodexDiagnosticsReport>
  prepareNetwork(signal?: AbortSignal): Promise<CodexNetworkDiagnosticConsent>
  runNetwork(consentId: string, signal?: AbortSignal): Promise<CodexDiagnosticsReport>
  history(signal?: AbortSignal): Promise<CodexDiagnosticsHistory>
  clearHistory(signal?: AbortSignal): Promise<{ readonly cleared: number }>
}

export interface AuthorizationClient {
  describe(signal?: AbortSignal): Promise<AuthorizationStatus>
  watch(attemptId: string, after: number, signal?: AbortSignal): Promise<{
    attemptId: string
    events: readonly AuthorizationEvent[]
    nextSeq: number
    done: boolean
  }>
  start(method?: string, signal?: AbortSignal): Promise<{ attemptId: string }>
  answer(attemptId: string, promptId: string, value: string): Promise<{ accepted: boolean }>
  decline(attemptId: string, promptId: string): Promise<{ accepted: boolean }>
  cancel(attemptId?: string): Promise<{
    accepted: boolean
    reason?: "commit-in-progress"
  }>
  logout(): Promise<{ signedOut: boolean }>
  usage(signal?: AbortSignal): Promise<CodexAccountUsage>
}

export interface CodexSessionPreference {
  fast: boolean
  transport: "auto" | "sse" | "websocket" | "websocket-cached"
  textVerbosity: "low" | "medium" | "high"
  reasoningSummary: "auto" | "concise" | "detailed" | "off"
  transportHealth?: CodexTransportHealth
}

export type CodexTransportHealth =
  | { status: "idle" }
  | {
      status: "observed"
      requests: number
      connectionsCreated: number
      connectionsReused: number
      cachedContextRequests: number
      fullContextRequests: number
      deltaRequests: number
      websocketFailures: number
      sseFallbacks: number
      websocketFallbackActive: boolean
    }

export interface CodexSessionModelPreference extends CodexSessionPreference {
  fastSupported: boolean
}

export interface SessionPreferenceClient {
  get(signal?: AbortSignal): Promise<CodexSessionPreference>
  getForModel(modelId: string, signal?: AbortSignal): Promise<CodexSessionModelPreference>
  setFast(fast: boolean, signal?: AbortSignal): Promise<CodexSessionPreference>
  setTransport(
    transport: CodexSessionPreference["transport"],
    signal?: AbortSignal,
  ): Promise<CodexSessionPreference>
  setTextVerbosity(
    textVerbosity: CodexSessionPreference["textVerbosity"],
    signal?: AbortSignal,
  ): Promise<CodexSessionPreference>
  setReasoningSummary(
    reasoningSummary: CodexSessionPreference["reasoningSummary"],
    signal?: AbortSignal,
  ): Promise<CodexSessionPreference>
}

export interface SessionPreferenceClientFactory {
  forSession(sessionId: string): SessionPreferenceClient
}

export interface CodexCurrentModel {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface CodexModelDirectoryState {
  current?: CodexCurrentModel | null
}

export type UseCodexModelDirectory = <Selected>(
  selector: (state: CodexModelDirectoryState) => Selected,
) => Selected

export interface CodexModelCatalogEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  inputModalities?: Array<"text" | "image">
  reasoning?: {
    efforts: Array<{ id: string; name: string }>
    defaultEffort?: string
  }
  fast?: boolean
}

export interface CodexModelEnablementSnapshot {
  kind: "ready"
  writable: boolean
  revision: number
  settingsNs: string
  settingsPath: string[]
  models: CodexModelCatalogEntry[]
  catalogIds: string[]
  selectedIds: string[]
  configuredModels: Array<{ id: string; [key: string]: unknown }>
}

export interface ModelEnablementClient {
  readonly available: boolean
  load(signal?: AbortSignal): Promise<CodexModelEnablementSnapshot | { kind: "unavailable" }>
  save(
    snapshot: CodexModelEnablementSnapshot,
    selectedIds: string[],
    signal?: AbortSignal,
  ): Promise<CodexModelEnablementSnapshot>
  subscribe(listener: () => void): () => void
}

export interface SettingsNamespaceMirrorView {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: "live" | "restart"
  secrets: readonly { path: readonly string[]; set: boolean }[]
  revision: number
}

export interface SettingsDescribeFace {
  getSnapshot(): {
    status: "idle" | "loading" | "ready" | "unavailable"
    view: {
      namespaces: readonly SettingsNamespaceMirrorView[]
      writable: boolean
      hasDocument: boolean
    } | undefined
    error: string | null
  }
  subscribe(listener: () => void): () => void
  ensure(): Promise<void>
  acceptView(view: SettingsNamespaceMirrorView): void
}

export interface CodexGlobalRequestDefaults {
  defaultFast: boolean
  defaultTransport: CodexSessionPreference["transport"]
  defaultTextVerbosity: CodexSessionPreference["textVerbosity"]
  defaultReasoningSummary: CodexSessionPreference["reasoningSummary"]
}

export type CodexGlobalRequestDefaultsSnapshot =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ready"
      writable: boolean
      value: CodexGlobalRequestDefaults
    }

export interface GlobalRequestDefaultsClient {
  readonly available: boolean
  load(): CodexGlobalRequestDefaultsSnapshot
  set<Field extends keyof CodexGlobalRequestDefaults>(
    field: Field,
    value: CodexGlobalRequestDefaults[Field],
  ): Promise<void>
  subscribe(listener: () => void): () => void
}

export interface RpcConnection {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>
  }
}

export declare function createAuthorizationClient(connection: RpcConnection): AuthorizationClient
export declare function createConnectionDiagnosticsClient(
  connection: RpcConnection,
): ConnectionDiagnosticsClient
export declare function createGlobalRequestDefaultsClient(
  scope: unknown,
): GlobalRequestDefaultsClient
export declare function createSessionPreferenceClient(
  connection: RpcConnection,
): SessionPreferenceClientFactory
export declare function createModelEnablementClient(
  connection: unknown,
  settingsFace?: SettingsDescribeFace,
): ModelEnablementClient
export declare const MODEL_CAPABILITIES_CHANNEL: "/dsh-codex-model-capabilities"
export declare function safeQuotaSnapshot(value: unknown, now?: number):
  | { status: "unknown" }
  | { status: "recent-success"; observedAt: number }
  | {
      status: "exhausted"
      observedAt: number
      resetAt?: number
      remainingMinutes?: number
    }
export declare function diagnosticsReportText(value: unknown): string
export declare function diagnosticsHistoryText(value: unknown): string
export declare function nextAccountUsageTransition(
  usage: CodexAccountUsage,
  now?: number,
): { at: number; refresh: boolean } | undefined
export declare function accountUsageReminders(
  usage: CodexAccountUsage,
  now?: number,
): readonly CodexAccountUsageReminder[]
export declare function formatResetDistance(
  resetsAt: number,
  t: (key: string) => string,
  now?: number,
): string
export declare function installSettingsNavIcon(): (() => void) | undefined
export declare function AuthorizationSettings(props: {
  client: AuthorizationClient
  t(key: string): string
}): unknown
export declare function ConnectionDiagnosticsSettings(props: {
  client: ConnectionDiagnosticsClient
  t(key: string): string
}): unknown
export declare function GlobalRequestDefaultsSettings(props: {
  client: GlobalRequestDefaultsClient
  t(key: string): string
}): unknown
export declare function CodexFastToggle(props: {
  session?: { removed?: boolean }
  useModelDirectory: UseCodexModelDirectory
  preferenceClient: SessionPreferenceClient
  selectModel?(selection: CodexCurrentModel): Promise<void> | void
  t(key: string): string
}): unknown
export declare function ModelEnablementSettings(props: {
  client: ModelEnablementClient
  t(key: string): string
}): unknown
export declare function CodexSettings(props: {
  client: AuthorizationClient
  diagnosticsClient: ConnectionDiagnosticsClient
  modelClient: ModelEnablementClient
  defaultsClient: GlobalRequestDefaultsClient
  t(key: string): string
}): unknown
export declare function apply(ctx: unknown): void
