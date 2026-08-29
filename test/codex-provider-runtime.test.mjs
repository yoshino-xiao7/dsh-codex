import assert from "node:assert/strict"
import test from "node:test"

import {
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
  assert.deepEqual(runtime.getConfig(), Config({}))
  assert.deepEqual(harness.adapters[0].providerInfo(CODEX_ROUTE_ID), {
    id: CODEX_ROUTE_ID,
    name: "Codex (ChatGPT OAuth)",
  })
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
  installCodexProviderRuntime(harness.ctx, Config({ models: [] }), {
    provider,
    sessionPreferences: { resolve: () => ({ fast: false, transport: "auto" }) },
  })

  assert.deepEqual(await harness.adapters[0].listModels(CODEX_ROUTE_ID), [])
  assert.equal((await harness.adapters[0].resolveModel(CODEX_ROUTE_ID, first.id)).id, first.id)
})

function fakeHarness(options = {}) {
  const adapterRoutes = []
  const adapters = []
  const directories = []
  const discoveries = []
  const flows = []
  const credentials = {
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
