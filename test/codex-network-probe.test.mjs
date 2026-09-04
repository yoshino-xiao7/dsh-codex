import assert from "node:assert/strict"
import test from "node:test"
import { zstdDecompressSync } from "node:zlib"

import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai"

import {
  createCodexNetworkProbe,
  createCodexNetworkProbeCoordinator,
} from "../src/internal/codex-network-probe.mjs"
import { CODEX_PROVIDER_ID } from "../src/internal/codex-credential-store.mjs"
import { createCodexPiProvider } from "../src/internal/codex-pi-provider.mjs"
import {
  Config,
  createCodexProfile,
} from "../src/internal/codex-provider-runtime.mjs"
import {
  CODEX_ROUTE_ID,
  CodexRouteAdapter,
} from "../src/internal/codex-route-adapter.mjs"

function fixture(events, options = {}) {
  const configured = []
  const removed = []
  const reset = []
  const requests = []
  const probe = createCodexNetworkProbe({
    coordinator: options.coordinator ?? createCodexNetworkProbeCoordinator(),
    timeoutMs: options.timeoutMs ?? 1_000,
    selectModel: async () => options.model ?? "gpt-fixture",
    sessionPreferences: {
      configure(sessionId, preferences) {
        configured.push({ sessionId, preferences })
      },
      remove: (sessionId) => removed.push(sessionId),
    },
    sessionResources: { reset: (sessionId) => reset.push(sessionId) },
    async *stream(request) {
      requests.push(request)
      if (typeof events === "function") yield* events(request)
      else yield* events
    },
  })
  return { configured, probe, removed, requests, reset }
}

function publicProviderProbe(responseFactory) {
  const provider = createCodexPiProvider()
  const profile = createCodexProfile(Config({}), provider)
  const canonical = new PiAiAdapter({
    profiles: () => new Map([[CODEX_PROVIDER_ID, profile]]),
    resolveApiKey: async () => undefined,
    auth: {
      credentials: memoryCredentials({
        type: "oauth",
        access: fakeAccessToken(),
        refresh: "refresh-probe",
        expires: Date.now() + 10 * 60_000,
      }),
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  const route = new CodexRouteAdapter(canonical)
  const model = provider.getModels().find(({ id }) => id === "gpt-5.4")
    ?? provider.getModels()[0]
  const probe = createCodexNetworkProbe({
    coordinator: createCodexNetworkProbeCoordinator(),
    selectModel: () => model.id,
    sessionPreferences: { configure() {}, remove() {} },
    sessionResources: { reset() {} },
    stream: (request) => route.stream(request),
  })
  let calls = 0
  let captured
  return {
    modelId: model.id,
    fetchCalls: () => calls,
    payload: () => captured,
    async run() {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (_url, request) => {
        calls += 1
        const headers = new Headers(request.headers)
        const bytes = Buffer.from(request.body)
        const json = headers.get("content-encoding") === "zstd"
          ? zstdDecompressSync(bytes).toString("utf8")
          : bytes.toString("utf8")
        captured = JSON.parse(json)
        return responseFactory()
      }
      try {
        return await probe.run(undefined, model.id)
      } finally {
        await new Promise((resolve) => setImmediate(resolve))
        probe.dispose()
        globalThis.fetch = originalFetch
      }
    },
  }
}

function fakeAccessToken() {
  const claims = {
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-probe" },
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `e30.${payload}.probe`
}

function memoryCredentials(credential) {
  return {
    read: async () => credential,
    list: async () => [{ providerId: CODEX_PROVIDER_ID, type: "oauth" }],
    modify: async (_provider, mutate) => (await mutate(credential)) ?? credential,
    delete: async () => undefined,
  }
}

function sseResponse(events) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  )
}

function terminalResponse(status) {
  return {
    id: "resp_fixture",
    object: "response",
    status,
    output: [],
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: status === "completed" ? 1 : 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: status === "completed" ? 2 : 1,
    },
  }
}

function assertPublishedProbePayload(payload, modelId) {
  assert.equal(payload.model, modelId)
  assert.equal(payload.stream, true)
  assert.equal(payload.store, false)
  assert.equal(payload.service_tier, undefined)
  assert.equal(payload.reasoning, undefined)
  assert.equal(payload.previous_response_id, undefined)
  assert.equal(Object.hasOwn(payload, "max_output_tokens"), false)
  assert.equal(payload.tools === undefined || payload.tools.length === 0, true)
  assert.equal(payload.input.length, 1)
  assert.equal(payload.input[0].role, "user")
  assert.equal(payload.input[0].content[0].text, "Reply with exactly OK.")
}

test("network probe sends one SDK-native request and tears down after first visible output", async () => {
  let continuedAfterOutput = false
  let teardownObserved = false
  const state = fixture(async function* () {
    try {
      yield { type: "text-delta", index: 0, text: "OK" }
      continuedAfterOutput = true
      yield { type: "finish", reason: { kind: "stop" } }
    } finally {
      teardownObserved = true
    }
  })

  assert.deepEqual(await state.probe.run(new AbortController().signal), {
    kind: "success",
    outputObserved: true,
  })
  assert.equal(state.requests.length, 1)
  assert.equal(state.requests[0].provider, "dsh-codex")
  assert.equal(state.requests[0].model, "gpt-fixture")
  assert.equal(Object.hasOwn(state.requests[0], "maxTokens"), false)
  assert.equal(state.requests[0].messages[0].content[0].text, "Reply with exactly OK.")
  assert.equal(state.requests[0].sessionId.startsWith("__dsh-codex-network-probe__:"), true)
  assert.deepEqual(state.configured[0].preferences, {
    fast: false,
    transport: "sse",
    textVerbosity: "low",
    reasoningSummary: "off",
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(continuedAfterOutput, false)
  assert.equal(teardownObserved, true)
  assert.equal(state.requests[0].signal.aborted, true)
  assert.deepEqual(state.removed, [state.configured[0].sessionId])
  assert.deepEqual(state.reset, [state.configured[0].sessionId])
  assert.doesNotMatch(JSON.stringify(await state.probe.run()), /OK/u)
})

test("network probe maps terminal failures to fixed content-free results", async (t) => {
  const cases = [
    ["QUOTA", "quota"],
    ["RATE_LIMIT", "rate-limit"],
    ["AUTH", "auth"],
    ["SERVER", "server"],
    ["TRANSPORT", "transport"],
    ["EMPTY_RESPONSE", "empty-response"],
    ["UNSUPPORTED_OPTION", "unsupported"],
    ["INVALID_REQUEST", "invalid-request"],
    ["PI_AI_ERROR", "provider-error"],
    ["UNKNOWN_MODEL", "unknown-model"],
    ["MISSING_CREDENTIAL", "missing-credential"],
    ["OTHER", "failure"],
  ]
  for (const [code, expected] of cases) {
    await t.test(code, async () => {
      const secret = `secret-${code}`
      const state = fixture([{
        type: "finish",
        reason: { kind: "error", failure: { code, message: secret } },
      }])
      const result = await state.probe.run()
      assert.deepEqual(result, { kind: expected, outputObserved: false })
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secret, "u"))
    })
  }
})

test("real provider chain accepts one 200 SSE response without a private output cap", async () => {
  const state = publicProviderProbe(() => sseResponse([
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "OK",
    },
    {
      type: "response.completed",
      response: terminalResponse("completed"),
    },
  ]))

  const result = await state.run()

  assert.deepEqual(result, { kind: "success", outputObserved: true })
  assert.equal(state.fetchCalls(), 1)
  assertPublishedProbePayload(state.payload(), state.modelId)
})

test("real provider chain maps response.incomplete without generic failure", async () => {
  const state = publicProviderProbe(() => sseResponse([{
    type: "response.incomplete",
    response: {
      ...terminalResponse("incomplete"),
      incomplete_details: { reason: "max_output_tokens" },
    },
  }]))

  const result = await state.run()

  assert.deepEqual(result, { kind: "max-tokens", outputObserved: false })
  assert.equal(state.fetchCalls(), 1)
  assertPublishedProbePayload(state.payload(), state.modelId)
})

test("real provider chain maps one HTTP 400 to a fixed sanitized category", async () => {
  const secret = "provider-400-body-must-not-cross"
  const state = publicProviderProbe(() => new Response(JSON.stringify({
    error: { code: "invalid_request_error", message: `invalid request ${secret}` },
  }), {
    status: 400,
    headers: { "content-type": "application/json" },
  }))

  const result = await state.run()

  assert.deepEqual(result, { kind: "invalid-request", outputObserved: false })
  assert.equal(state.fetchCalls(), 1)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret, "u"))
  assertPublishedProbePayload(state.payload(), state.modelId)
})

test("network probe handles model absence, cancellation, and cleanup", async () => {
  const absent = fixture([], { model: "" })
  assert.deepEqual(await absent.probe.run(), {
    kind: "model-unavailable",
    outputObserved: false,
  })
  assert.equal(absent.requests.length, 0)

  const controller = new AbortController()
  const cancelled = fixture(async function* () {
    controller.abort(new Error("secret abort"))
    yield { type: "finish", reason: { kind: "aborted" } }
  })
  assert.deepEqual(await cancelled.probe.run(controller.signal), {
    kind: "cancelled-after-attempt",
    outputObserved: false,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(cancelled.removed.length, 1)
  assert.equal(cancelled.reset.length, 1)
})

test("network probe refuses overlapping real requests", async () => {
  let release
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  const state = fixture(async function* () {
    markStarted()
    await gate
    yield { type: "finish", reason: { kind: "stop" } }
  })

  const first = state.probe.run()
  await started
  assert.deepEqual(await state.probe.run(), {
    kind: "busy",
    outputObserved: false,
  })
  assert.equal(state.requests.length, 1)
  release()
  assert.deepEqual(await first, {
    kind: "empty-response",
    outputObserved: false,
  })
})

test("network probe distinguishes cancellation before and after request dispatch", async () => {
  const before = new AbortController()
  before.abort(new Error("secret before dispatch"))
  const notDispatched = fixture([])
  assert.deepEqual(await notDispatched.probe.run(before.signal), {
    kind: "cancelled",
    outputObserved: false,
  })
  assert.equal(notDispatched.requests.length, 0)

  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const after = new AbortController()
  const dispatched = fixture(async function* (request) {
    markStarted()
    await new Promise((resolve) => {
      request.signal.addEventListener("abort", resolve, { once: true })
    })
  })
  const pending = dispatched.probe.run(after.signal)
  await started
  after.abort(new Error("secret after dispatch"))
  assert.deepEqual(await pending, {
    kind: "cancelled-after-attempt",
    outputObserved: false,
  })
})

test("network probe treats a stop without observed output as an empty response", async () => {
  const state = fixture([{ type: "finish", reason: { kind: "stop" } }])

  assert.deepEqual(await state.probe.run(), {
    kind: "empty-response",
    outputObserved: false,
  })
})

test("network probe enforces a hard deadline when the stream ignores abort", async () => {
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const state = fixture(async function* () {
    markStarted()
    await new Promise(() => undefined)
  }, { timeoutMs: 5 })

  const pending = state.probe.run()
  await started
  assert.deepEqual(await pending, {
    kind: "timeout",
    outputObserved: false,
  })
  assert.equal(state.requests.length, 1)
  assert.equal(state.removed.length, 0)
  assert.equal(state.reset.length, 0)
  assert.deepEqual(await state.probe.run(), {
    kind: "busy",
    outputObserved: false,
  }, "an uncooperative old request must quarantine later real probes")
})

test("disposing the network probe cancels an uncooperative active stream", async () => {
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const state = fixture(async function* () {
    markStarted()
    await new Promise(() => undefined)
  })

  const pending = state.probe.run()
  await started
  state.probe.dispose()
  state.probe.dispose()
  assert.deepEqual(await pending, {
    kind: "cancelled-after-attempt",
    outputObserved: false,
  })
  assert.deepEqual(await state.probe.run(), {
    kind: "cancelled",
    outputObserved: false,
  })
  assert.equal(state.removed.length, 0)
  assert.equal(state.reset.length, 0)
})

test("network probe retains safe preferences and resources until late next and teardown settle", async () => {
  let resolveNext
  let resolveReturn
  let markNextStarted
  const nextStarted = new Promise((resolve) => { markNextStarted = resolve })
  const nextGate = new Promise((resolve) => { resolveNext = resolve })
  const returnGate = new Promise((resolve) => { resolveReturn = resolve })
  const requests = []
  const preferences = new Map()
  const removed = []
  const reset = []
  const owned = new Set()
  const observedPreferences = []
  const unsafeDefaults = Object.freeze({
    fast: true,
    transport: "websocket-cached",
    textVerbosity: "high",
    reasoningSummary: "detailed",
  })
  let streams = 0
  const probe = createCodexNetworkProbe({
    coordinator: createCodexNetworkProbeCoordinator(),
    timeoutMs: 5,
    selectModel: async () => "gpt-fixture",
    sessionPreferences: {
      configure(sessionId, value) {
        preferences.set(sessionId, value)
      },
      remove(sessionId) {
        removed.push(sessionId)
        preferences.delete(sessionId)
      },
    },
    sessionResources: {
      reset(sessionId) {
        reset.push(sessionId)
        owned.delete(sessionId)
      },
    },
    stream(request) {
      requests.push(request)
      streams += 1
      if (streams > 1) {
        let step = 0
        return {
          [Symbol.asyncIterator]() { return this },
          async next() {
            step += 1
            return step === 1
              ? { done: false, value: { type: "text-delta", text: "OK" } }
              : { done: false, value: { type: "finish", reason: { kind: "stop" } } }
          },
          async return() { return { done: true } },
        }
      }
      return {
        [Symbol.asyncIterator]() { return this },
        next() {
          markNextStarted()
          return nextGate.then((value) => {
            observedPreferences.push(preferences.get(request.sessionId) ?? unsafeDefaults)
            owned.add(request.sessionId)
            return value
          })
        },
        return() { return returnGate },
      }
    },
  })

  const first = probe.run()
  await nextStarted
  assert.deepEqual(await first, { kind: "timeout", outputObserved: false })
  const firstSessionId = requests[0].sessionId
  assert.deepEqual(preferences.get(firstSessionId), {
    fast: false,
    transport: "sse",
    textVerbosity: "low",
    reasoningSummary: "off",
  })
  assert.deepEqual(removed, [])
  assert.deepEqual(reset, [])
  assert.deepEqual(await probe.run(), { kind: "busy", outputObserved: false })

  resolveNext({ done: false, value: { type: "text-delta", text: "late secret" } })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(observedPreferences, [{
    fast: false,
    transport: "sse",
    textVerbosity: "low",
    reasoningSummary: "off",
  }])
  assert.equal(owned.has(firstSessionId), true)
  assert.deepEqual(removed, [])
  assert.deepEqual(reset, [])
  assert.deepEqual(await probe.run(), {
    kind: "busy",
    outputObserved: false,
  }, "a late chunk must not release quarantine while iterator.return is pending")

  resolveReturn({ done: true })
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(removed, [firstSessionId])
  assert.deepEqual(reset, [firstSessionId])
  assert.equal(owned.has(firstSessionId), false)
  assert.deepEqual(await probe.run(), { kind: "success", outputObserved: true })
  assert.equal(requests.length, 2)
  probe.dispose()
  probe.dispose()
})

test("network probe releases quarantine after a rejected next and successful teardown", async () => {
  let rejectNext
  let resolveReturn
  let markNextStarted
  const nextStarted = new Promise((resolve) => { markNextStarted = resolve })
  const nextGate = new Promise((_resolve, reject) => { rejectNext = reject })
  const returnGate = new Promise((resolve) => { resolveReturn = resolve })
  let streams = 0
  const probe = createCodexNetworkProbe({
    coordinator: createCodexNetworkProbeCoordinator(),
    timeoutMs: 5,
    selectModel: async () => "gpt-fixture",
    sessionPreferences: { configure() {}, remove() {} },
    sessionResources: { reset() {} },
    stream() {
      streams += 1
      if (streams > 1) {
        let step = 0
        return {
          [Symbol.asyncIterator]() { return this },
          async next() {
            step += 1
            return {
              done: false,
              value: step === 1
                ? { type: "text-delta", text: "OK" }
                : { type: "finish", reason: { kind: "stop" } },
            }
          },
          return: async () => ({ done: true }),
        }
      }
      return {
        [Symbol.asyncIterator]() { return this },
        next() {
          markNextStarted()
          return nextGate
        },
        return() { return returnGate },
      }
    },
  })

  const first = probe.run()
  await nextStarted
  assert.deepEqual(await first, { kind: "timeout", outputObserved: false })
  rejectNext(new Error("sanitized rejected next"))
  resolveReturn({ done: true })
  await new Promise((resolve) => setImmediate(resolve))

  const second = await probe.run()
  assert.equal(streams, 2)
  assert.deepEqual(second, { kind: "success", outputObserved: true })
  probe.dispose()
})

test("network probe coordinator quarantines a reloaded instance until old teardown", async () => {
  const coordinator = createCodexNetworkProbeCoordinator()
  let resolveNext
  let resolveReturn
  let markNextStarted
  const nextStarted = new Promise((resolve) => { markNextStarted = resolve })
  const nextGate = new Promise((resolve) => { resolveNext = resolve })
  const returnGate = new Promise((resolve) => { resolveReturn = resolve })
  const firstRequests = []
  const secondRequests = []
  const dependencies = {
    coordinator,
    selectModel: async () => "gpt-fixture",
    sessionPreferences: { configure() {}, remove() {} },
    sessionResources: { reset() {} },
  }
  const first = createCodexNetworkProbe({
    ...dependencies,
    timeoutMs: 5,
    stream(request) {
      firstRequests.push(request)
      return {
        [Symbol.asyncIterator]() { return this },
        next() {
          markNextStarted()
          return nextGate
        },
        return() { return returnGate },
      }
    },
  })
  const firstRun = first.run()
  await nextStarted
  assert.deepEqual(await firstRun, { kind: "timeout", outputObserved: false })
  first.dispose()

  const second = createCodexNetworkProbe({
    ...dependencies,
    stream(request) {
      secondRequests.push(request)
      let step = 0
      return {
        [Symbol.asyncIterator]() { return this },
        async next() {
          step += 1
          return {
            done: false,
            value: step === 1
              ? { type: "text-delta", text: "OK" }
              : { type: "finish", reason: { kind: "stop" } },
          }
        },
        async return() { return { done: true } },
      }
    },
  })
  assert.deepEqual(await second.run(), { kind: "busy", outputObserved: false })
  assert.equal(secondRequests.length, 0)

  resolveNext({ done: true })
  resolveReturn({ done: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(await second.run(), { kind: "success", outputObserved: true })
  assert.equal(secondRequests.length, 1)
  assert.notEqual(firstRequests[0].sessionId, secondRequests[0].sessionId)
  second.dispose()
})

test("network probe never releases quarantine without confirmed iterator teardown", async (t) => {
  for (const teardown of ["missing", "incomplete", "rejected", "throwing-getter"]) {
    await t.test(teardown, async () => {
      const coordinator = createCodexNetworkProbeCoordinator()
      let resolveNext
      let markNextStarted
      const nextStarted = new Promise((resolve) => { markNextStarted = resolve })
      const nextGate = new Promise((resolve) => { resolveNext = resolve })
      const iterator = {
        [Symbol.asyncIterator]() { return this },
        next() {
          markNextStarted()
          return nextGate
        },
        ...(teardown === "incomplete"
          ? { async return() { return { done: false } } }
          : teardown === "rejected"
            ? { async return() { throw new Error("secret rejected teardown") } }
            : {}),
      }
      if (teardown === "throwing-getter") {
        Object.defineProperty(iterator, "return", {
          get() {
            throw new Error("secret return getter failure")
          },
        })
      }
      const probe = createCodexNetworkProbe({
        coordinator,
        timeoutMs: 5,
        selectModel: async () => "gpt-fixture",
        sessionPreferences: { configure() {}, remove() {} },
        sessionResources: { reset() {} },
        stream: () => iterator,
      })

      const first = probe.run()
      await nextStarted
      assert.deepEqual(await first, { kind: "timeout", outputObserved: false })
      resolveNext({ done: true })
      await new Promise((resolve) => setImmediate(resolve))
      assert.deepEqual(await probe.run(), { kind: "busy", outputObserved: false })
      probe.dispose()
    })
  }
})

test("default quarantine survives module re-evaluation in the same process", async () => {
  const reloaded = await import("../src/internal/codex-network-probe.mjs?reload-coordinator-test")
  let resolveNext
  let resolveReturn
  let markNextStarted
  const nextStarted = new Promise((resolve) => { markNextStarted = resolve })
  const nextGate = new Promise((resolve) => { resolveNext = resolve })
  const returnGate = new Promise((resolve) => { resolveReturn = resolve })
  let firstRequests = 0
  let secondRequests = 0
  const dependencies = {
    selectModel: async () => "gpt-fixture",
    sessionPreferences: { configure() {}, remove() {} },
    sessionResources: { reset() {} },
  }
  const first = createCodexNetworkProbe({
    ...dependencies,
    timeoutMs: 5,
    stream() {
      firstRequests += 1
      return {
        [Symbol.asyncIterator]() { return this },
        next() {
          markNextStarted()
          return nextGate
        },
        return() { return returnGate },
      }
    },
  })
  const firstRun = first.run()
  await nextStarted
  assert.deepEqual(await firstRun, { kind: "timeout", outputObserved: false })

  const second = reloaded.createCodexNetworkProbe({
    ...dependencies,
    stream() {
      secondRequests += 1
      let step = 0
      return {
        [Symbol.asyncIterator]() { return this },
        async next() {
          step += 1
          return {
            done: false,
            value: step === 1
              ? { type: "text-delta", text: "OK" }
              : { type: "finish", reason: { kind: "stop" } },
          }
        },
        async return() { return { done: true } },
      }
    },
  })
  assert.deepEqual(await second.run(), { kind: "busy", outputObserved: false })
  assert.equal(secondRequests, 0)

  resolveNext({ done: true })
  resolveReturn({ done: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(await second.run(), { kind: "success", outputObserved: true })
  assert.equal(firstRequests, 1)
  assert.equal(secondRequests, 1)
  first.dispose()
  second.dispose()
})

test("network probe quarantines later requests when synchronous session cleanup fails", async (t) => {
  for (const failure of ["remove", "reset"]) {
    await t.test(failure, async () => {
      let requests = 0
      const probe = createCodexNetworkProbe({
        coordinator: createCodexNetworkProbeCoordinator(),
        selectModel: async () => "gpt-fixture",
        sessionPreferences: {
          configure() {},
          remove() {
            if (failure === "remove") throw new Error("secret remove failure")
          },
        },
        sessionResources: {
          reset() {
            if (failure === "reset") throw new Error("secret reset failure")
          },
        },
        stream() {
          requests += 1
          return {
            [Symbol.asyncIterator]() { return this },
            async next() { return { done: true } },
          }
        },
      })

      assert.deepEqual(await probe.run(), {
        kind: "stream-closed",
        outputObserved: false,
      })
      assert.deepEqual(await probe.run(), { kind: "busy", outputObserved: false })
      assert.equal(requests, 1)
      probe.dispose()
    })
  }
})
