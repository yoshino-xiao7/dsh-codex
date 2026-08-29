import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai"
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm"
import { createModels } from "@earendil-works/pi-ai"
import {
  installSettingsSection,
  settingsNamespace,
} from "@deepseek-ai/dsh-settings"
import Schema from "@deepseek-ai/schemastery"

import { registerCodexAuthorizationFlow } from "./codex-authorization.mjs"
import { createCodexAccountUsageReader } from "./codex-account-usage.mjs"
import {
  CODEX_PROVIDER_ID,
  createCodexCredentialStore,
} from "./codex-credential-store.mjs"
import { createCodexPiProvider } from "./codex-pi-provider.mjs"
import {
  CODEX_ROUTE_ID,
  CodexRouteAdapter,
} from "./codex-route-adapter.mjs"
import {
  DEFAULT_IMAGE_POLICY,
  resolveImagePolicy,
} from "./image-policy.mjs"

export const CODEX_SETTINGS_NAMESPACE = settingsNamespace("dsh-codex")

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const MODEL_SCHEMA = Schema.object({
  id: Schema.string().required(),
  name: Schema.string(),
  contextWindow: Schema.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  maxTokens: Schema.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
})

export const Config = Schema.object({
  partialResponseRecovery: Schema.boolean()
    .default(true)
    .description("Preserve safe partial text instead of replaying an already-visible Codex request"),
  models: Schema.array(MODEL_SCHEMA).default(undefined),
  cacheRetention: Schema.union(["none", "short", "long"]).default("short"),
  streamIdleTimeoutMs: Schema.number()
    .min(1)
    .max(MAX_TIMER_DELAY_MS)
    .default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestImageBytes: Schema.number()
    .step(1)
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_IMAGE_POLICY.maxRequestImageBytes),
  requestImagePixelBudget: Schema.number()
    .step(1)
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_IMAGE_POLICY.requestImagePixelBudget),
  requestImageMaxBytes: Schema.number()
    .step(1)
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_IMAGE_POLICY.requestImageMaxBytes),
})

const RETRY_POLICY = resolveRetryPolicy({
  mode: "normal",
  maxRetries: 2,
  retryableCodes: [
    "EMPTY_RESPONSE",
    "RATE_LIMIT",
    "SERVER",
    "TIMEOUT",
    "TRANSPORT",
  ],
  backoff: {
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    jitterRatio: 0.1,
  },
}, "dsh-codex provider retryPolicy")

const DEFAULT_SESSION_PREFERENCES = Object.freeze({ fast: false, transport: "auto" })

/**
 * Materialize the one immutable PiAiAdapter profile for a settings snapshot.
 * Model filtering and all request/image bounds are decided here; OAuth and
 * wire behavior stay inside the injected public pi-ai provider.
 */
export function createCodexProfile(config, provider = createCodexPiProvider()) {
  if (provider?.id !== CODEX_PROVIDER_ID || provider.auth?.oauth === undefined) {
    throw new TypeError("provider must be the OAuth-capable Codex provider")
  }
  if (config.models !== undefined && !Array.isArray(config.models)) {
    throw new TypeError("models must be omitted or an array")
  }
  if (!Number.isFinite(config.streamIdleTimeoutMs)
    || config.streamIdleTimeoutMs < 1
    || config.streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`streamIdleTimeoutMs must be a finite number from 1 through ${MAX_TIMER_DELAY_MS}`)
  }
  const image = resolveImagePolicy(config)
  const models = configuredModels(config.models, provider.getModels())
  const configuredMaxTokens = new Map()
  for (const row of config.models ?? []) {
    if (row.maxTokens !== undefined) configuredMaxTokens.set(row.id, row.maxTokens)
  }

  return Object.freeze({
    provider: CODEX_PROVIDER_ID,
    displayName: "Codex (ChatGPT OAuth)",
    cacheRetention: config.cacheRetention,
    transport: "auto",
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    ...image,
    retryPolicy: RETRY_POLICY,
    piProvider: providerWithModels(provider, models),
    configuredMaxTokens,
  })
}

/**
 * Install the plugin-owned route, OAuth flow, and settings namespace.
 * The returned interface intentionally exposes only the live resolved config;
 * callers do not coordinate adapter snapshots or credential writes themselves.
 */
export function installCodexProviderRuntime(ctx, entryConfig = {}, options = {}) {
  const entry = Config(entryConfig)
  const sessionPreferences = options.sessionPreferences
  const sessionResources = options.sessionResources
  const resolveSessionPreferences = (sessionId) => sessionPreferences?.resolve(sessionId)
    ?? DEFAULT_SESSION_PREFERENCES
  const provider = options.provider ?? createCodexPiProvider({
    resolveSessionPreferences,
    ...(sessionResources === undefined
      ? {}
      : {
          resolveTransportSessionId: (sessionId) => (
            sessionResources.transportSessionId(sessionId)
          ),
        }),
  })
  const credentialStore = createCodexCredentialStore(ctx.credentials)
  const authContext = Object.freeze({
    env: async () => undefined,
    fileExists: async () => false,
  })
  const authModels = createModels({ credentials: credentialStore, authContext })
  authModels.setProvider(provider)
  const accountUsageReader = createCodexAccountUsageReader({
    baseUrl: provider.baseUrl,
    ...(options.accountUsageFetch === undefined ? {} : { fetch: options.accountUsageFetch }),
    ...(options.accountUsageClock === undefined ? {} : { clock: options.accountUsageClock }),
    resolveAuth: async ({ signal }) => {
      if (signal.aborted) throw signal.reason
      const resolved = await authModels.getAuth(provider.id)
      if (signal.aborted) throw signal.reason
      const credential = await credentialStore.read(provider.id)
      if (
        resolved?.auth?.apiKey === undefined
        || credential?.type !== "oauth"
        || resolved.auth.apiKey !== credential.access
      ) {
        throw new Error("Codex OAuth credential is unavailable")
      }
      return { access: credential.access, accountId: credential.accountId }
    },
  })

  let source = () => entry
  let previousConfig
  let previousProfiles
  const profiles = () => {
    const current = source()
    if (current === previousConfig && previousProfiles !== undefined) return previousProfiles
    const profile = createCodexProfile(current, provider)
    previousConfig = current
    previousProfiles = new Map([[CODEX_PROVIDER_ID, profile]])
    return previousProfiles
  }
  profiles()

  const canonicalAdapter = new PiAiAdapter({
    profiles,
    resolveApiKey: async () => undefined,
    auth: { credentials: credentialStore, authContext },
    resolveAttachments: () => ctx.get?.("attachments"),
    onReplayDegrade: ({ model, reason }) => {
      ctx.logger.warn(`dsh-codex: unusable replay state for ${CODEX_PROVIDER_ID}/${model}; using provider-neutral history (${reason})`)
    },
  })

  registerCodexAuthorizationFlow({
    ownerContext: ctx,
    authorization: ctx.authorization,
    credentialStore,
    authContext,
    provider,
    commitTracker: options.authorizationCommitTracker,
  })
  const routeAdapter = new CodexRouteAdapter(canonicalAdapter, {
    filterModels(models) {
      const configured = source().models
      if (configured === undefined) return models
      const visible = new Set(configured.map(({ id }) => id))
      return models.filter(({ id }) => visible.has(id))
    },
  })
  ctx.llm.registerAdapter([CODEX_ROUTE_ID], routeAdapter)
  ctx.llm.registerModelDiscovery(CODEX_SETTINGS_NAMESPACE, (request) => {
    if (request.signal?.aborted === true) {
      return Promise.reject(request.signal.reason ?? new Error("model discovery cancelled"))
    }
    if (request.provider !== undefined && request.provider !== CODEX_ROUTE_ID) {
      return Promise.reject(new Error("dsh-codex model discovery does not own this route"))
    }
    return Promise.resolve(provider.getModels().map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })))
  })

  installSettingsSection(ctx, CODEX_SETTINGS_NAMESPACE, Config, entry, {
    validate: (candidate) => {
      createCodexProfile(candidate, provider)
    },
    setSource(current) {
      source = current
    },
    onChange() {
      // PiAiAdapter reads the profile map once per operation; invalid settings
      // are rejected by validate before this source can become authoritative.
      profiles()
    },
  })

  return Object.freeze({
    accountUsageReader,
    getConfig: () => source(),
  })
}

function configuredModels(configured, catalog) {
  const byId = new Map(catalog.map((model) => [model.id, model]))
  if (configured === undefined) return [...catalog]

  const seen = new Set()
  const overrides = new Map()
  for (const [index, row] of configured.entries()) {
    for (const field of ["name", "contextWindow", "maxTokens"]) {
      if (row[field] === null) throw new TypeError(`models[${index}].${field} must not be null`)
    }
    if (seen.has(row.id)) throw new Error(`Codex model "${row.id}" is listed more than once`)
    seen.add(row.id)
    const base = byId.get(row.id)
    if (base === undefined) throw new Error(`unknown Codex model "${row.id}"`)
    overrides.set(row.id, Object.freeze({
      ...base,
      ...(row.name === undefined ? {} : { name: row.name }),
      ...(row.contextWindow === undefined ? {} : { contextWindow: row.contextWindow }),
      ...(row.maxTokens === undefined ? {} : { maxTokens: row.maxTokens }),
    }))
  }
  return catalog.map((model) => overrides.get(model.id) ?? model)
}

function providerWithModels(provider, models) {
  const selected = Object.freeze([...models])
  return Object.freeze({
    id: provider.id,
    name: provider.name,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    ...(provider.headers === undefined ? {} : { headers: provider.headers }),
    auth: provider.auth,
    getModels: () => selected,
    ...(provider.filterModels === undefined
      ? {}
      : { filterModels: (entries, credential) => provider.filterModels(entries, credential) }),
    stream: (model, context, options) => provider.stream(model, context, options),
    streamSimple: (model, context, options) => provider.streamSimple(model, context, options),
  })
}
