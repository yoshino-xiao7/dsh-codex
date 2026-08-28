import assert from "node:assert/strict"
import test from "node:test"

import { createSessionPreferences } from "../src/internal/session-preferences.mjs"

test("session preferences default to safe provider behavior", () => {
  const preferences = createSessionPreferences()

  assert.deepEqual(preferences.resolve(), {
    fast: false,
    transport: "auto",
  })
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: false,
    transport: "auto",
  })
})

test("session preferences isolate explicit Fast and transport choices", () => {
  const preferences = createSessionPreferences()

  assert.deepEqual(preferences.configure("session-a", { fast: true }), {
    fast: true,
    transport: "auto",
  })
  assert.deepEqual(preferences.configure("session-a", { transport: "sse" }), {
    fast: true,
    transport: "sse",
  })
  assert.deepEqual(preferences.resolve("session-b"), {
    fast: false,
    transport: "auto",
  })

  preferences.remove("session-a")
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: false,
    transport: "auto",
  })
})

test("session preferences reject ambiguous or unbounded input", () => {
  const preferences = createSessionPreferences({ maxSessions: 1 })

  assert.throws(() => preferences.configure("", { fast: true }), /session id/u)
  assert.throws(() => preferences.configure("x".repeat(257), { fast: true }), /session id/u)
  assert.throws(() => preferences.configure("session-a", {}), /preference/u)
  assert.throws(() => preferences.configure("session-a", { fast: "yes" }), /fast/u)
  assert.throws(() => preferences.configure("session-a", { transport: "udp" }), /transport/u)
  assert.throws(() => preferences.configure("session-a", { fast: true, extra: true }), /preference/u)

  preferences.configure("session-a", { fast: true })
  assert.throws(() => preferences.configure("session-b", { fast: true }), /capacity/u)
})

test("session preference snapshots are immutable and disposal closes writes", () => {
  const preferences = createSessionPreferences()
  const snapshot = preferences.configure("session-a", {
    fast: true,
    transport: "websocket-cached",
  })

  assert.equal(Object.isFrozen(snapshot), true)
  assert.throws(() => {
    snapshot.fast = false
  }, TypeError)

  preferences.dispose()
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: false,
    transport: "auto",
  })
  assert.throws(() => preferences.configure("session-a", { fast: false }), /disposed/u)
})
