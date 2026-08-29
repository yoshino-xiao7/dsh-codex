import assert from "node:assert/strict"
import test from "node:test"

import {
  CodexSessionPreferenceBridge,
  SESSION_PREFERENCE_RPC_CHANNEL,
  createSessionPreferenceRpcHandler,
  registerSessionPreferenceRpc,
} from "../src/internal/session-preference-bridge.mjs"
import { createSessionPreferences } from "../src/internal/session-preferences.mjs"

test("session preference bridge gets and changes only Fast for one exact session", async () => {
  const preferences = createSessionPreferences()
  const bridge = new CodexSessionPreferenceBridge(preferences)
  const handler = createSessionPreferenceRpcHandler(bridge)
  const signal = new AbortController().signal

  assert.deepEqual(await handler("get", { sessionId: "session-a" }, signal), {
    ok: true,
    value: { fast: false },
  })
  assert.deepEqual(await handler("get", { sessionId: "x" }, signal), {
    ok: true,
    value: { fast: false },
  })
  assert.deepEqual(await handler("get", { sessionId: "x".repeat(256) }, signal), {
    ok: true,
    value: { fast: false },
  })
  assert.deepEqual(await handler("set-fast", {
    sessionId: "session-a",
    fast: true,
  }, signal), {
    ok: true,
    value: { fast: true },
  })
  assert.deepEqual(preferences.resolve("session-a"), { fast: true, transport: "auto" })
  assert.deepEqual(preferences.resolve("session-b"), { fast: false, transport: "auto" })
  assert.deepEqual(Object.keys((await bridge.get({ sessionId: "session-a" }))).sort(), ["fast"])
})

test("session preference RPC strictly rejects malformed payloads and unknown endpoints", async () => {
  let resolveCalls = 0
  let configureCalls = 0
  const bridge = new CodexSessionPreferenceBridge({
    resolve() {
      resolveCalls += 1
      return { fast: false, transport: "auto" }
    },
    configure() {
      configureCalls += 1
      return { fast: true, transport: "auto" }
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
    ["set-fast", { sessionId: "session-a" }],
    ["set-fast", { sessionId: "session-a", fast: "true" }],
    ["set-fast", { sessionId: "session-a", fast: true, transport: "sse" }],
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

  const bridge = registerSessionPreferenceRpc(context, preferences)

  assert.ok(bridge instanceof CodexSessionPreferenceBridge)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].channel, SESSION_PREFERENCE_RPC_CHANNEL)
  assert.deepEqual(registrations[0].options, { authority: "loopback" })
  assert.deepEqual(
    await registrations[0].handler("get", { sessionId: "session-a" }, new AbortController().signal),
    { ok: true, value: { fast: false } },
  )
})
