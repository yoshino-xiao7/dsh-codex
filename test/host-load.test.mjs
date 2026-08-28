import assert from "node:assert/strict"
import test from "node:test"

import { Config, apply, inject, name } from "../src/host/index.mjs"
import { CODEX_ROUTE_ID } from "../src/internal/codex-route-adapter.mjs"

test("host entry exports a valid Cordis plugin and scoped stream listener", async () => {
  const listeners = []
  const dynamicInjections = []
  const warnings = []
  const effects = []
  const adapterRoutes = []
  const discoveries = []
  const flows = []
  const context = {
    fiber: { state: 0 },
    logger: { warn: (message) => warnings.push(message) },
    credentials: {
      readRecord: async () => undefined,
      describeRecord: async () => ({ configured: false, writable: true }),
      modifyRecord: async (_key, mutate) => mutate(undefined),
      deleteRecord: async () => undefined,
    },
    authorization: {
      registerFlow(flow) {
        flows.push(flow)
        return () => undefined
      },
    },
    llm: {
      registerAdapter(routes) {
        adapterRoutes.push([...routes])
        const dispose = () => undefined
        dispose.replace = () => undefined
        return dispose
      },
      registerModelDiscovery(namespace, discover) {
        discoveries.push({ namespace, discover })
        return () => undefined
      },
    },
    get() {
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return dispose
    },
    on(event, listener, options) {
      listeners.push({ event, listener, options })
      return () => undefined
    },
    inject(services, callback) {
      dynamicInjections.push({ services, callback })
    },
  }

  assert.equal(name, "dsh-codex")
  assert.deepEqual(inject, ["llm", "authorization", "credentials"])
  assert.equal(Config({}).partialResponseRecovery, true)
  apply(context, {})

  assert.deepEqual(adapterRoutes, [[CODEX_ROUTE_ID]])
  assert.equal(flows.length, 1)
  assert.equal(discoveries.length, 1)
  assert.deepEqual(listeners.map(({ event }) => event), [
    "agent/disposed",
    "llm/stream",
  ])
  const streamListener = listeners.find(({ event }) => event === "llm/stream")
  assert.deepEqual(streamListener.options, { global: true })
  assert.deepEqual(dynamicInjections.map(({ services }) => services), [
    ["settings"],
    ["connection"],
    ["commands"],
    ["tools", "attachments"],
  ])
  assert.ok(dynamicInjections.every(({ callback }) => typeof callback === "function"))

  const output = []
  const source = async function* source() {
    yield { type: "finish", reason: { kind: "stop" } }
  }
  for await (const chunk of streamListener.listener(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => source(),
  )) output.push(chunk)

  assert.deepEqual(output, [{ type: "finish", reason: { kind: "stop" } }])
  assert.deepEqual(warnings, [])

  let rpcHandler
  dynamicInjections.find(({ services }) => services[0] === "connection").callback({
    authorization: {
      describe: () => undefined,
      cancel: () => undefined,
    },
    credentials: {
      describeRecord: async () => ({ configured: false, writable: true }),
      deleteRecord: async () => undefined,
    },
    connection: {
      rpc: {
        handle(_channel, handler) {
          rpcHandler = handler
        },
      },
    },
    effect(callback) {
      return callback()
    },
  })
  const status = await rpcHandler("status", {}, new AbortController().signal)
  assert.equal(status.ok, true)
  assert.equal(status.value.quota.status, "recent-success")

  const commands = []
  dynamicInjections.find(({ services }) => services[0] === "commands").callback({
    commands: { register: (command) => commands.push(command) },
    authorization: {
      describe: () => undefined,
      cancel: () => undefined,
    },
    credentials: {
      describeRecord: async () => ({ configured: false, writable: true }),
      deleteRecord: async () => undefined,
    },
  })
  assert.deepEqual(commands.map(({ name: commandName }) => commandName), [
    "codex",
    "codex-login",
    "codex-usage",
  ])

  const imageListeners = []
  const imageEffects = []
  dynamicInjections.find(({ services }) => services[0] === "tools").callback({
    get() {
      return undefined
    },
    on(event, listener, options) {
      imageListeners.push({ event, listener, options })
      return () => undefined
    },
    effect(callback) {
      const dispose = callback()
      imageEffects.push(dispose)
      return dispose
    },
  })
  assert.deepEqual(imageListeners.map(({ event, options }) => ({ event, options })), [{
    event: "tools/execute",
    options: { global: true },
  }])
  assert.equal(imageEffects.length, 1)
  assert.equal(typeof imageEffects[0], "function")
  await imageEffects[0]()
  await assert.rejects(imageListeners[0].listener({
    name: "read_image",
    arguments: { file_path: "https://images.example.net/after-dispose.png" },
    signal: new AbortController().signal,
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => {
    throw new Error("disposed URL middleware must not delegate")
  }), (error) => error?.code === "ABORTED")
  assert.equal(effects.every((dispose) => typeof dispose === "function"), true)
})

test("host stream observations are sanitized through status RPC and codex-usage", async () => {
  const harness = createHostObservationHarness()
  const initial = await harness.status()
  assert.equal(initial.ok, true)
  assert.deepEqual(initial.value.quota, { status: "unknown" })

  const ambiguousFailure = {
    code: "PI_AI_ERROR",
    message: "You have hit your ChatGPT usage limit. Try again in ~17 min.",
  }
  const ambiguous = await harness.stream([{
    type: "finish",
    reason: { kind: "error", failure: ambiguousFailure },
  }])
  assert.equal(ambiguous.at(-1).reason.kind, "error")
  assert.equal(ambiguous.at(-1).reason.failure.code, "QUOTA_OR_RATE_LIMIT")
  assert.deepEqual((await harness.status()).value.quota, { status: "unknown" })

  const resetAt = Math.floor(Date.now() / 1_000) * 1_000 + 60 * 60_000
  const resetIso = new Date(resetAt).toISOString()
  const requestId = "req_host_quota_fixture"
  const providerSecret = "secret_host_quota_fixture"
  const quotaObservedAfter = Date.now()
  const quota = await harness.stream([{
    type: "finish",
    reason: {
      kind: "error",
      failure: {
        code: "RATE_LIMIT",
        status: 429,
        message: `OpenAI API error (429): ${JSON.stringify({
          error: {
            code: "AccountQuotaExceeded",
            message: "You have exceeded the 5-hour usage quota.",
            resetAt: resetIso,
            requestId,
            access_token: providerSecret,
          },
        })}`,
      },
    },
  }])
  const quotaTerminal = quota.at(-1)
  assert.equal(quotaTerminal.reason.kind, "error")
  assert.equal(quotaTerminal.reason.failure.code, "QUOTA")
  assert.equal(quotaTerminal.reason.failure.status, 429)
  assert.equal(quotaTerminal.reason.failure.requestId, requestId)
  assert.match(quotaTerminal.reason.failure.message, new RegExp(resetIso.replace(".000Z", "\\.000Z"), "u"))
  assert.doesNotMatch(
    JSON.stringify(quotaTerminal.reason.failure),
    new RegExp(`AccountQuotaExceeded|access_token|${providerSecret}`, "u"),
  )

  const exhausted = await harness.status()
  assert.equal(exhausted.ok, true)
  assert.equal(exhausted.value.quota.status, "exhausted")
  assert.equal(exhausted.value.quota.resetAt, resetAt)
  assert.equal(exhausted.value.quota.observedAt >= quotaObservedAfter, true)
  assert.deepEqual(
    Object.keys(exhausted.value.quota),
    ["status", "observedAt", "resetAt"],
  )
  assert.doesNotMatch(
    JSON.stringify(exhausted.value.quota),
    new RegExp(`${requestId}|${providerSecret}|AccountQuotaExceeded`, "u"),
  )

  const usageAtQuota = await harness.usage.handler({ rawInput: "status" })
  assert.equal(usageAtQuota.kind, "success")
  assert.match(usageAtQuota.text, new RegExp(resetIso.replace(".000Z", "\\.000Z"), "u"))
  assert.doesNotMatch(
    usageAtQuota.text,
    new RegExp(`${requestId}|${providerSecret}|AccountQuotaExceeded`, "u"),
  )

  await harness.stream([{
    type: "finish",
    reason: { kind: "error", failure: ambiguousFailure },
  }])
  assert.deepEqual((await harness.status()).value.quota, exhausted.value.quota)

  const successObservedAfter = Date.now()
  const success = await harness.stream([{
    type: "finish",
    reason: { kind: "stop" },
  }])
  assert.equal(success.at(-1).reason.kind, "stop")
  const recent = await harness.status()
  assert.equal(recent.value.quota.status, "recent-success")
  assert.equal(recent.value.quota.observedAt >= successObservedAfter, true)
  assert.equal("resetAt" in recent.value.quota, false)
  const usageAfterSuccess = await harness.usage.handler({ rawInput: "status" })
  assert.equal(usageAfterSuccess.kind, "success")
  assert.match(usageAfterSuccess.text, /does not represent remaining account quota/iu)
  assert.deepEqual(harness.warnings, [])
})

function createHostObservationHarness() {
  const listeners = []
  const dynamicInjections = []
  const warnings = []
  const context = {
    fiber: { state: 0 },
    logger: { warn: (message) => warnings.push(message) },
    credentials: {
      readRecord: async () => undefined,
      describeRecord: async () => ({ configured: false, writable: true }),
      modifyRecord: async (_key, mutate) => mutate(undefined),
      deleteRecord: async () => undefined,
    },
    authorization: {
      registerFlow: () => () => undefined,
    },
    llm: {
      registerAdapter() {
        const dispose = () => undefined
        dispose.replace = () => undefined
        return dispose
      },
      registerModelDiscovery: () => () => undefined,
    },
    get: () => undefined,
    effect(callback) {
      return callback()
    },
    on(event, listener, options) {
      listeners.push({ event, listener, options })
      return () => undefined
    },
    inject(services, callback) {
      dynamicInjections.push({ services, callback })
    },
  }
  apply(context, {})

  const streamListener = listeners.find(({ event }) => event === "llm/stream")?.listener
  assert.equal(typeof streamListener, "function")

  let rpcHandler
  dynamicInjections.find(({ services }) => services[0] === "connection")?.callback({
    authorization: {
      describe: () => undefined,
      cancel: () => undefined,
    },
    credentials: {
      describeRecord: async () => ({ configured: false, writable: true }),
      deleteRecord: async () => undefined,
    },
    connection: {
      rpc: {
        handle(_channel, handler) {
          rpcHandler = handler
        },
      },
    },
    effect(callback) {
      return callback()
    },
  })
  assert.equal(typeof rpcHandler, "function")

  const commands = []
  dynamicInjections.find(({ services }) => services[0] === "commands")?.callback({
    commands: { register: (command) => commands.push(command) },
    authorization: {
      describe: () => undefined,
      cancel: () => undefined,
    },
    credentials: {
      describeRecord: async () => ({ configured: false, writable: true }),
      deleteRecord: async () => undefined,
    },
  })
  const usage = commands.find(({ name: commandName }) => commandName === "codex-usage")
  assert.equal(typeof usage?.handler, "function")

  return {
    warnings,
    usage,
    status: () => rpcHandler("status", {}, new AbortController().signal),
    async stream(chunks) {
      const output = []
      const source = async function* source() {
        yield* chunks
      }
      for await (const chunk of streamListener(
        { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
        () => source(),
      )) output.push(chunk)
      return output
    },
  }
}
