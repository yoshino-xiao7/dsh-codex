import assert from "node:assert/strict"
import test from "node:test"

import {
  CODEX_CREDENTIAL_KEY,
  CODEX_PROVIDER_ID,
} from "../src/internal/codex-credential-store.mjs"
import {
  CODEX_SETTINGS_NAMESPACE,
  Config,
  createCodexProfile,
  installCodexProviderRuntime,
} from "../src/internal/codex-provider-runtime.mjs"
import { createCodexPiProvider } from "../src/internal/codex-pi-provider.mjs"
import { CODEX_ROUTE_ID } from "../src/internal/codex-route-adapter.mjs"

const RUNTIME_ACCESS = "runtime-refreshed-access-must-not-leak"
const RUNTIME_ACCOUNT_ID = "runtime-account-id-must-not-leak"
const RUNTIME_NOW = 1_787_973_000_000

function codexProviderWithOAuth(oauth) {
  const provider = createCodexPiProvider()
  return Object.freeze({
    ...provider,
    baseUrl: "https://chatgpt.example/backend-api",
    auth: Object.freeze({ oauth: Object.freeze(oauth) }),
  })
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

test("Codex runtime config resolves safe image, cache, and recovery defaults", () => {
  const config = Config({})
  const nullDefaults = Config({
    partialResponseRecovery: null,
    cacheRetention: null,
    streamIdleTimeoutMs: null,
    maxRequestImageBytes: null,
    requestImagePixelBudget: null,
    requestImageMaxBytes: null,
  })

  assert.equal(config.partialResponseRecovery, true)
  assert.equal(config.cacheRetention, "short")
  assert.equal(config.streamIdleTimeoutMs, 300_000)
  assert.equal(config.maxRequestImageBytes, 20_971_520)
  assert.equal(config.requestImagePixelBudget, 4_194_304)
  assert.equal(config.requestImageMaxBytes, 1_048_576)
  assert.equal(config.models, undefined)
  assert.equal(nullDefaults.partialResponseRecovery, true)
  assert.equal(nullDefaults.cacheRetention, "short")
  assert.equal(nullDefaults.streamIdleTimeoutMs, 300_000)
  assert.equal(nullDefaults.maxRequestImageBytes, 20_971_520)
  assert.equal(nullDefaults.requestImagePixelBudget, 4_194_304)
  assert.equal(nullDefaults.requestImageMaxBytes, 1_048_576)

  for (const requestImagePixelBudget of ["", 0, -1, 1.5, Number.NaN]) {
    assert.throws(() => Config({ requestImagePixelBudget }))
  }
})

test("Codex runtime config rejects non-finite timers and nullable model overrides", () => {
  const provider = createCodexPiProvider()
  const known = provider.getModels()[0].id

  for (const streamIdleTimeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => createCodexProfile(
        { ...Config({}), streamIdleTimeoutMs },
        provider,
      ),
      /streamIdleTimeoutMs.*finite/iu,
    )
  }
  for (const field of ["name", "contextWindow", "maxTokens"]) {
    assert.throws(
      () => createCodexProfile(Config({ models: [{ id: known, [field]: null }] }), provider),
      new RegExp(`models\\[0\\]\\.${field}`, "u"),
    )
  }
  assert.throws(
    () => createCodexProfile(Config({ models: null }), provider),
    /models must be omitted or an array/iu,
  )
})

test("profile selection keeps provider auth/stream ownership and applies only known model overrides", () => {
  const provider = createCodexPiProvider()
  const catalog = provider.getModels()
  assert.equal(catalog.length >= 2, true)
  const selected = [catalog[1], catalog[0]]
  const profile = createCodexProfile(Config({
    models: [
      { id: selected[0].id, name: "Preferred Codex", maxTokens: 4_096 },
      { id: selected[1].id, contextWindow: 131_072 },
    ],
  }), provider)
  const models = profile.piProvider.getModels()

  assert.deepEqual(models.map(({ id }) => id), catalog.map(({ id }) => id))
  const preferred = models.find(({ id }) => id === selected[0].id)
  const resized = models.find(({ id }) => id === selected[1].id)
  assert.equal(preferred.name, "Preferred Codex")
  assert.equal(preferred.maxTokens, 4_096)
  assert.equal(resized.contextWindow, 131_072)
  assert.equal(profile.configuredMaxTokens.get(selected[0].id), 4_096)
  assert.equal(profile.piProvider.auth, provider.auth)
  assert.equal(profile.transport, "auto")
  assert.equal(profile.retryPolicy.retryableCodes.includes("QUOTA"), false)
  assert.equal(profile.retryPolicy.retryableCodes.includes("QUOTA_OR_RATE_LIMIT"), false)
  assert.equal(profile.retryPolicy.retryableCodes.includes("TRANSPORT"), true)
})

test("an empty model selection keeps the catalog while duplicate and unknown rows fail", () => {
  const provider = createCodexPiProvider()
  const known = provider.getModels()[0].id

  assert.deepEqual(
    createCodexProfile(Config({ models: [] }), provider)
      .piProvider.getModels(),
    provider.getModels(),
  )
  assert.throws(
    () => createCodexProfile(Config({ models: [{ id: known }, { id: known }] }), provider),
    /more than once/u,
  )
  assert.throws(
    () => createCodexProfile(Config({ models: [{ id: "not-in-the-catalog" }] }), provider),
    /unknown Codex model/u,
  )
})

test("runtime registers one external route, owned OAuth flow, and direct catalog discovery", async () => {
  const harness = fakeHarness()
  const runtime = installCodexProviderRuntime(harness.ctx, Config({}), {
    sessionPreferences: {
      resolve: () => ({ fast: false, transport: "auto" }),
    },
  })

  assert.deepEqual(harness.adapterRoutes, [[CODEX_ROUTE_ID]])
  assert.equal(harness.adapters.length, 1)
  assert.deepEqual(harness.directories, [])
  assert.equal(harness.flows.length, 1)
  assert.equal(harness.flows[0].key, "dsh-codex/openai-codex")
  assert.equal(harness.discoveries.length, 1)
  assert.equal(harness.discoveries[0].namespace, CODEX_SETTINGS_NAMESPACE)
  const catalog = await harness.discoveries[0].discover({
    provider: CODEX_ROUTE_ID,
    signal: new AbortController().signal,
  })
  assert.equal(catalog.length > 0, true)
  assert.equal(catalog.every(({ id, name }) => (
    typeof id === "string" && id.length > 0
    && typeof name === "string" && name.length > 0
  )), true)
  assert.equal(catalog.every((model) => (
    Object.keys(model).sort().join(",") === "contextWindow,id,maxTokens,name"
  )), true)
  const capabilityCatalog = runtime.getModelCapabilities()
  assert.deepEqual(capabilityCatalog.map(({ id }) => id), catalog.map(({ id }) => id))
  const knownCapabilities = capabilityCatalog.find(({ reasoning }) => reasoning !== undefined)
  assert.ok(knownCapabilities)
  assert.equal(Array.isArray(knownCapabilities.inputModalities), true)
  assert.equal(Array.isArray(knownCapabilities.reasoning.efforts), true)
  assert.equal(Object.hasOwn(knownCapabilities.reasoning, "defaultEffort"), false)
  assert.equal(typeof knownCapabilities.fast, "boolean")
  assert.deepEqual(runtime.getConfig(), Config({}))
  assert.deepEqual(harness.adapters[0].providerInfo(CODEX_ROUTE_ID), {
    id: CODEX_ROUTE_ID,
    name: "Codex (ChatGPT OAuth)",
  })
})

test("runtime account usage refreshes stored OAuth and sends the final access and account headers", async () => {
  let credentialRecord = {
    kind: "grant",
    payload: {
      type: "oauth",
      access: "expired-access-must-not-be-used",
      refresh: "runtime-refresh-must-not-leak",
      expires: 1,
      accountId: RUNTIME_ACCOUNT_ID,
    },
  }
  let refreshCalls = 0
  let request
  const credentials = {
    async readRecord(key) {
      assert.equal(key, CODEX_CREDENTIAL_KEY)
      return structuredClone(credentialRecord)
    },
    async describeRecord() {
      return { configured: true, kind: "grant", writable: true }
    },
    async modifyRecord(key, mutate) {
      assert.equal(key, CODEX_CREDENTIAL_KEY)
      credentialRecord = await mutate(structuredClone(credentialRecord))
      return structuredClone(credentialRecord)
    },
    async deleteRecord() {},
  }
  const provider = codexProviderWithOAuth({
    name: "Codex OAuth test double",
    async login() {
      throw new Error("login is not used by account usage")
    },
    async refresh(credential) {
      refreshCalls += 1
      assert.equal(credential.accountId, RUNTIME_ACCOUNT_ID)
      return {
        ...credential,
        access: RUNTIME_ACCESS,
        refresh: "runtime-rotated-refresh-must-not-leak",
        expires: 4_102_444_800_000,
      }
    },
    async toAuth(credential) {
      return { apiKey: credential.access }
    },
  })
  const harness = fakeHarness({ credentials })
  const runtime = installCodexProviderRuntime(harness.ctx, Config({}), {
    provider,
    sessionPreferences: { resolve: () => ({ fast: false, transport: "auto" }) },
    accountUsageClock: () => RUNTIME_NOW,
    accountUsageFetch: async (url, init) => {
      request = { url, init }
      return jsonResponse({
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 18_000,
            reset_at: 1_787_991_000,
          },
          secondary_window: {
            used_percent: 7.5,
            limit_window_seconds: 604_800,
            reset_at: 1_788_577_800,
          },
        },
      })
    },
  })

  const snapshot = await runtime.accountUsageReader.read()

  assert.equal(refreshCalls, 1)
  assert.equal(request.url, "https://chatgpt.example/backend-api/wham/usage")
  assert.equal(request.init.method, "GET")
  assert.equal(request.init.redirect, "error")
  assert.equal(request.init.headers.Authorization, `Bearer ${RUNTIME_ACCESS}`)
  assert.equal(request.init.headers["ChatGPT-Account-Id"], RUNTIME_ACCOUNT_ID)
  assert.deepEqual(snapshot, {
    observedAt: RUNTIME_NOW,
    planType: "plus",
    rateLimits: [{
      limitId: "codex",
      limitName: null,
      primary: {
        usedPercent: 25,
        windowDurationMins: 300,
        resetsAt: 1_787_991_000_000,
      },
      secondary: {
        usedPercent: 7.5,
        windowDurationMins: 10_080,
        resetsAt: 1_788_577_800_000,
      },
    }],
  })
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /runtime-refreshed-access|runtime-account-id|runtime-rotated-refresh/u,
  )
})

test("runtime account usage sanitizes OAuth derivation failures and never starts the request", async () => {
  const secret = "runtime-oauth-derivation-secret-must-not-leak"
  const credentials = {
    async readRecord() {
      return {
        kind: "grant",
        payload: {
          type: "oauth",
          access: secret,
          refresh: "runtime-refresh-secret-must-not-leak",
          expires: 4_102_444_800_000,
          accountId: RUNTIME_ACCOUNT_ID,
        },
      }
    },
    async describeRecord() {
      return { configured: true, kind: "grant", writable: true }
    },
    async modifyRecord(_key, mutate) {
      return mutate(undefined)
    },
    async deleteRecord() {},
  }
  const provider = codexProviderWithOAuth({
    name: "Codex OAuth failing test double",
    async login() {
      throw new Error("login is not used by account usage")
    },
    async refresh() {
      throw new Error("refresh is not used for an unexpired credential")
    },
    async toAuth() {
      throw new Error(`OAuth derivation failed for ${secret}`)
    },
  })
  let fetchCalled = false
  const runtime = installCodexProviderRuntime(fakeHarness({ credentials }).ctx, Config({}), {
    provider,
    sessionPreferences: { resolve: () => ({ fast: false, transport: "auto" }) },
    accountUsageFetch: async () => {
      fetchCalled = true
      return jsonResponse({ rate_limit: {} })
    },
  })

  await assert.rejects(runtime.accountUsageReader.read(), (error) => {
    assert.equal(error.code, "AUTH_UNAVAILABLE")
    assert.doesNotMatch(
      `${String(error)} ${JSON.stringify(error)} ${error.stack ?? ""}`,
      /runtime-oauth-derivation-secret|runtime-refresh-secret|runtime-account-id/u,
    )
    assert.equal("cause" in error, false)
    return true
  })
  assert.equal(fetchCalled, false)
})

test("settings namespace changes the next adapter operation without mutating an in-flight snapshot", async () => {
  const provider = createCodexPiProvider()
  const [first, second] = provider.getModels()
  let resolved = Config({ models: [{ id: first.id }] })
  let watcher
  let validator
  const settingsContext = {
    settings: {
      register(namespace, schema, options) {
        assert.equal(namespace, CODEX_SETTINGS_NAMESPACE)
        assert.equal(schema, Config)
        validator = options.validate
        return {
          get: () => resolved,
          watch(callback) {
            watcher = callback
            return () => undefined
          },
        }
      },
    },
    effect(callback) {
      callback()
      return () => undefined
    },
  }
  const harness = fakeHarness({ settingsContext })
  installCodexProviderRuntime(harness.ctx, Config({}), {
    provider,
    sessionPreferences: { resolve: () => ({ fast: false, transport: "auto" }) },
  })
  const adapter = harness.adapters[0]

  assert.deepEqual((await adapter.listModels(CODEX_ROUTE_ID)).map(({ id, provider: route }) => [id, route]), [
    [first.id, CODEX_ROUTE_ID],
  ])
  const previous = resolved
  resolved = Config({ models: [{ id: second.id }] })
  validator(resolved)
  assert.throws(
    () => validator(Config({ models: [{ id: first.id, maxTokens: null }] })),
    /models\[0\]\.maxTokens must not be null/u,
  )
  assert.throws(
    () => validator({ ...Config({}), streamIdleTimeoutMs: Number.NaN }),
    /streamIdleTimeoutMs.*finite/iu,
  )
  await watcher(resolved, previous)
  assert.deepEqual((await adapter.listModels(CODEX_ROUTE_ID)).map(({ id, provider: route }) => [id, route]), [
    [second.id, CODEX_ROUTE_ID],
  ])
  assert.equal((await adapter.resolveModel(CODEX_ROUTE_ID, first.id)).id, first.id)
})

test("an explicit empty model list hides discovery without invalidating exact model resolution", async () => {
  const provider = createCodexPiProvider()
  const first = provider.getModels()[0]
  const harness = fakeHarness()
  const runtime = installCodexProviderRuntime(harness.ctx, Config({ models: [] }), {
    provider,
    sessionPreferences: { resolve: () => ({ fast: false, transport: "auto" }) },
  })

  assert.deepEqual(await harness.adapters[0].listModels(CODEX_ROUTE_ID), [])
  assert.equal((await harness.adapters[0].resolveModel(CODEX_ROUTE_ID, first.id)).id, first.id)
  const report = await runtime.connectionDiagnostics.run("local", new AbortController().signal)
  assert.equal(report.outcome, "warning")
  assert.deepEqual(report.checks.find(({ id }) => id === "models"), {
    id: "models",
    status: "warning",
    code: "models-disabled",
    facts: {
      catalogCount: provider.getModels().length,
      enabledCount: 0,
      selection: "custom",
      allEnabled: false,
    },
  })
})

function fakeHarness(options = {}) {
  const adapterRoutes = []
  const adapters = []
  const directories = []
  const discoveries = []
  const flows = []
  const credentials = options.credentials ?? {
    readRecord: async () => undefined,
    describeRecord: async () => ({ configured: false, writable: true }),
    modifyRecord: async (_key, mutate) => mutate(undefined),
    deleteRecord: async () => undefined,
  }
  const ctx = {
    fiber: { state: 0 },
    credentials,
    authorization: {
      registerFlow(flow) {
        flows.push(flow)
        return () => undefined
      },
    },
    llm: {
      registerAdapter(routes, adapter) {
        adapterRoutes.push([...routes])
        adapters.push(adapter)
        const dispose = () => undefined
        dispose.replace = () => undefined
        return dispose
      },
      registerConfigurableProviders(entries) {
        directories.push(entries.map((entry) => ({ ...entry, settingsPath: [...entry.settingsPath] })))
        const dispose = () => undefined
        dispose.replace = () => undefined
        return dispose
      },
      registerModelDiscovery(namespace, discover) {
        discoveries.push({ namespace, discover })
        return () => undefined
      },
    },
    logger: { warn() {} },
    get() {
      return undefined
    },
    inject(services, callback) {
      if (services.length === 1 && services[0] === "settings" && options.settingsContext !== undefined) {
        callback(options.settingsContext)
      }
    },
  }
  return { ctx, adapterRoutes, adapters, directories, discoveries, flows }
}
