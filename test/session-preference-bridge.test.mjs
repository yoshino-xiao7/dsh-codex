import assert from "node:assert/strict"
import test from "node:test"

import {
  CodexSessionPreferenceBridge,
  SESSION_PREFERENCE_RPC_CHANNEL,
  createSessionPreferenceRpcHandler,
  registerSessionPreferenceRpc,
} from "../src/internal/session-preference-bridge.mjs"
import { createSessionPreferences } from "../src/internal/session-preferences.mjs"

test("session preference bridge gets and changes public controls for one exact session", async () => {
  const preferences = createSessionPreferences()
  const bridge = new CodexSessionPreferenceBridge(preferences)
  const handler = createSessionPreferenceRpcHandler(bridge)
  const signal = new AbortController().signal

  assert.deepEqual(await handler("get", { sessionId: "session-a" }, signal), {
    ok: true,
    value: {
      fast: false,
      transport: "auto",
      textVerbosity: "low",
      reasoningSummary: "auto",
    },
  })
  assert.deepEqual(await handler("get", {
    sessionId: "session-a",
    modelId: "gpt-5.6-sol",
  }, signal), {
    ok: true,
    value: {
      fast: false,
      transport: "auto",
      textVerbosity: "low",
      reasoningSummary: "auto",
      fastSupported: true,
    },
  })
  assert.deepEqual(await handler("get", {
    sessionId: "session-a",
    modelId: "gpt-future",
  }, signal), {
    ok: true,
    value: {
      fast: false,
      transport: "auto",
      textVerbosity: "low",
      reasoningSummary: "auto",
      fastSupported: false,
    },
  })
  assert.deepEqual(await handler("get", { sessionId: "x" }, signal), {
    ok: true,
    value: {
      fast: false,
      transport: "auto",
      textVerbosity: "low",
      reasoningSummary: "auto",
    },
  })
  assert.deepEqual(await handler("get", { sessionId: "x".repeat(256) }, signal), {
    ok: true,
    value: {
      fast: false,
      transport: "auto",
      textVerbosity: "low",
      reasoningSummary: "auto",
    },
  })
  assert.deepEqual(await handler("set-fast", {
    sessionId: "session-a",
    fast: true,
  }, signal), {
    ok: true,
    value: {
      fast: true,
      transport: "auto",
      textVerbosity: "low",
      reasoningSummary: "auto",
    },
  })
  assert.deepEqual(await handler("set-transport", {
    sessionId: "session-a",
    transport: "websocket-cached",
  }, signal), {
    ok: true,
    value: {
      fast: true,
      transport: "websocket-cached",
      textVerbosity: "low",
      reasoningSummary: "auto",
    },
  })
  assert.deepEqual(await handler("set-text-verbosity", {
    sessionId: "session-a",
    textVerbosity: "high",
  }, signal), {
    ok: true,
    value: {
      fast: true,
      transport: "websocket-cached",
      textVerbosity: "high",
      reasoningSummary: "auto",
    },
  })
  assert.deepEqual(await handler("set-reasoning-summary", {
    sessionId: "session-a",
    reasoningSummary: "detailed",
  }, signal), {
    ok: true,
    value: {
      fast: true,
      transport: "websocket-cached",
      textVerbosity: "high",
      reasoningSummary: "detailed",
    },
  })
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: true,
    transport: "websocket-cached",
    textVerbosity: "high",
    reasoningSummary: "detailed",
  })
  assert.deepEqual(preferences.resolve("session-b"), {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.deepEqual(Object.keys((await bridge.get({ sessionId: "session-a" }))).sort(), [
    "fast",
    "reasoningSummary",
    "textVerbosity",
    "transport",
  ])
})

test("session preference bridge exposes only projected transport health on reads and writes", async () => {
  const secret = "raw-transport-debug-secret"
  const healthCalls = []
  const preferences = createSessionPreferences()
  const sessionResources = {
    transportHealth(sessionId) {
      healthCalls.push(sessionId)
      return {
        status: "observed",
        requests: 8,
        connectionsCreated: 3,
        connectionsReused: 5,
        cachedContextRequests: 4,
        fullContextRequests: 2,
        deltaRequests: 6,
        websocketFailures: 1,
        sseFallbacks: 1,
        websocketFallbackActive: true,
        lastPreviousResponseId: secret,
        lastWebSocketError: secret,
      }
    },
  }
  const bridge = new CodexSessionPreferenceBridge(preferences, { sessionResources })
  const handler = createSessionPreferenceRpcHandler(bridge)
  const signal = new AbortController().signal
  const expectedHealth = {
    status: "observed",
    requests: 8,
    connectionsCreated: 3,
    connectionsReused: 5,
    cachedContextRequests: 4,
    fullContextRequests: 2,
    deltaRequests: 6,
    websocketFailures: 1,
    sseFallbacks: 1,
    websocketFallbackActive: true,
  }

  const read = await handler("get", {
    sessionId: "session-health",
    modelId: "gpt-5.6-sol",
  }, signal)
  assert.equal(read.ok, true)
  assert.deepEqual(read.value.transportHealth, expectedHealth)
  assert.equal(read.value.fastSupported, true)
  assert.doesNotMatch(JSON.stringify(read), new RegExp(secret, "u"))

  const write = await handler("set-fast", {
    sessionId: "session-health",
    fast: true,
  }, signal)
  assert.equal(write.ok, true)
  assert.deepEqual(write.value.transportHealth, expectedHealth)
  assert.equal(write.value.fast, true)
  assert.doesNotMatch(JSON.stringify(write), new RegExp(secret, "u"))
  assert.deepEqual(healthCalls, ["session-health", "session-health"])
})

test("session preference bridge clears only the selected session transport state on explicit transport changes", async () => {
  const preferences = createSessionPreferences()
  preferences.configure("session-b", { transport: "sse" })
  const resets = []
  const bridge = new CodexSessionPreferenceBridge(preferences, {
    transportHealth: () => ({ status: "idle" }),
    reset: (sessionId) => resets.push(sessionId),
  })
  const handler = createSessionPreferenceRpcHandler(bridge)
  const signal = new AbortController().signal

  for (const transport of ["auto", "websocket", "websocket-cached", "sse"]) {
    const result = await handler("set-transport", {
      sessionId: "session-a",
      transport,
    }, signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.transport, transport)
    assert.deepEqual(result.value.transportHealth, { status: "idle" })
    assert.equal(preferences.resolve("session-a").transport, transport)
  }

  assert.deepEqual(resets, ["session-a", "session-a", "session-a", "session-a"])
  assert.equal(preferences.resolve("session-b").transport, "sse")
})

test("session preference bridge fails closed on malformed transport health", async () => {
  const preferences = createSessionPreferences()
  const handler = createSessionPreferenceRpcHandler(new CodexSessionPreferenceBridge(
    preferences,
    { transportHealth: () => ({ status: "observed", requests: "many" }) },
  ))

  assert.deepEqual(
    await handler("get", { sessionId: "session-a" }, new AbortController().signal),
    {
      ok: false,
      error: { code: "internal", message: "Session preference request failed", details: {} },
    },
  )
})

test("session preference RPC strictly rejects malformed payloads and unknown endpoints", async () => {
  let resolveCalls = 0
  let configureCalls = 0
  const bridge = new CodexSessionPreferenceBridge({
    resolve() {
      resolveCalls += 1
      return {
        fast: false,
        transport: "auto",
        textVerbosity: "low",
        reasoningSummary: "auto",
      }
    },
    configure() {
      configureCalls += 1
      return {
        fast: true,
        transport: "auto",
        textVerbosity: "low",
        reasoningSummary: "auto",
      }
    },
  })
  const handler = createSessionPreferenceRpcHandler(bridge)
  const signal = new AbortController().signal
  const invalid = [
    ["get", null],
    ["get", []],
    ["get", {}],
    ["get", { sessionId: "" }],
    ["get", { sessionId: "x".repeat(257) }],
    ["get", { sessionId: 1 }],
    ["get", { sessionId: "session-a", fast: false }],
    ["get", { sessionId: "session-a", modelId: "" }],
    ["get", { sessionId: "session-a", modelId: "x".repeat(257) }],
    ["set-fast", { sessionId: "session-a" }],
    ["set-fast", { sessionId: "session-a", fast: "true" }],
    ["set-fast", { sessionId: "session-a", fast: true, transport: "sse" }],
    ["set-transport", { sessionId: "session-a" }],
    ["set-transport", { sessionId: "session-a", transport: "udp" }],
    ["set-transport", { sessionId: "session-a", transport: "sse", fast: false }],
    ["set-text-verbosity", { sessionId: "session-a" }],
    ["set-text-verbosity", { sessionId: "session-a", textVerbosity: "verbose" }],
    ["set-text-verbosity", { sessionId: "session-a", textVerbosity: "low", fast: false }],
    ["set-reasoning-summary", { sessionId: "session-a" }],
    ["set-reasoning-summary", { sessionId: "session-a", reasoningSummary: "full" }],
    ["set-reasoning-summary", {
      sessionId: "session-a",
      reasoningSummary: "auto",
      transport: "sse",
    }],
    ["unknown", { sessionId: "session-a" }],
  ]

  for (const [endpoint, payload] of invalid) {
    const result = await handler(endpoint, payload, signal)
    assert.equal(result.ok, false, `${endpoint}: ${JSON.stringify(payload)}`)
    assert.equal(result.error.code, "bad-request")
    assert.deepEqual(result.error.details, { issues: [] })
  }
  assert.equal(resolveCalls, 0)
  assert.equal(configureCalls, 0)
})

test("session preference RPC contains cancellation and internal diagnostics", async () => {
  const secret = "session-preference-secret-diagnostic"
  let resolveCalls = 0
  const handler = createSessionPreferenceRpcHandler(new CodexSessionPreferenceBridge({
    resolve() {
      resolveCalls += 1
      throw new Error(secret)
    },
    configure() {
      throw new Error(secret)
    },
  }))

  const cancelled = new AbortController()
  cancelled.abort(secret)
  const cancelledResult = await handler("get", { sessionId: "session-a" }, cancelled.signal)
  assert.deepEqual(cancelledResult, {
    ok: false,
    error: { code: "cancelled", message: "Request cancelled", details: {} },
  })
  assert.equal(resolveCalls, 0)
  assert.doesNotMatch(JSON.stringify(cancelledResult), new RegExp(secret, "u"))

  const failed = await handler("get", { sessionId: "session-a" }, new AbortController().signal)
  assert.deepEqual(failed, {
    ok: false,
    error: { code: "internal", message: "Session preference request failed", details: {} },
  })
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret, "u"))
})

test("session preference RPC registers on its own loopback-only channel", async () => {
  const registrations = []
  const preferences = createSessionPreferences()
  const context = {
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registrations.push({ channel, handler, options })
        },
      },
    },
  }

  const bridge = registerSessionPreferenceRpc(context, preferences, {
    transportHealth: () => ({ status: "idle", lastWebSocketError: "must-not-cross" }),
  })

  assert.ok(bridge instanceof CodexSessionPreferenceBridge)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].channel, SESSION_PREFERENCE_RPC_CHANNEL)
  assert.deepEqual(registrations[0].options, { authority: "loopback" })
  assert.deepEqual(
    await registrations[0].handler("get", { sessionId: "session-a" }, new AbortController().signal),
    {
      ok: true,
      value: {
        fast: false,
        transport: "auto",
        textVerbosity: "low",
        reasoningSummary: "auto",
        transportHealth: { status: "idle" },
      },
    },
  )
})
