export declare const CHANNEL: "/dsh-codex"
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
}

export interface CodexModelCatalogEntry {
  id: string
  name?: string
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
export declare function createModelEnablementClient(
  connection: unknown,
  settingsFace?: SettingsDescribeFace,
): ModelEnablementClient
export declare function safeQuotaSnapshot(value: unknown, now?: number):
  | { status: "unknown" }
  | { status: "recent-success"; observedAt: number }
  | {
      status: "exhausted"
      observedAt: number
      resetAt?: number
      remainingMinutes?: number
    }
export declare function AuthorizationSettings(props: {
  client: AuthorizationClient
  t(key: string): string
}): unknown
export declare function ModelEnablementSettings(props: {
  client: ModelEnablementClient
  t(key: string): string
}): unknown
export declare function CodexSettings(props: {
  client: AuthorizationClient
  modelClient: ModelEnablementClient
  t(key: string): string
}): unknown
export declare function apply(ctx: unknown): void
