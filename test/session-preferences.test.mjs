import assert from "node:assert/strict"
import test from "node:test"

import { createSessionPreferences } from "../src/internal/session-preferences.mjs"

test("session preferences default to safe provider behavior", () => {
  const preferences = createSessionPreferences()

  assert.deepEqual(preferences.resolve(), {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
})

test("session preferences isolate explicit request choices", () => {
  const preferences = createSessionPreferences()

  assert.deepEqual(preferences.configure("session-a", { fast: true }), {
    fast: true,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.deepEqual(preferences.configure("session-a", { transport: "sse" }), {
    fast: true,
    transport: "sse",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.deepEqual(preferences.configure("session-a", {
    textVerbosity: "high",
    reasoningSummary: "detailed",
  }), {
    fast: true,
    transport: "sse",
    textVerbosity: "high",
    reasoningSummary: "detailed",
  })
  assert.deepEqual(preferences.resolve("session-b"), {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })

  preferences.remove("session-a")
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
})

test("session preferences accept explicit defaults for all public controls", () => {
  const preferences = createSessionPreferences({
    defaultFast: true,
    defaultTransport: "websocket",
    defaultTextVerbosity: "medium",
    defaultReasoningSummary: "concise",
  })

  assert.deepEqual(preferences.resolve("session-a"), {
    fast: true,
    transport: "websocket",
    textVerbosity: "medium",
    reasoningSummary: "concise",
  })
})

test("session overrides stay sparse while live defaults change atomically", () => {
  const preferences = createSessionPreferences()
  preferences.configure("session-a", { fast: true })
  preferences.configure("session-b", { transport: "sse", textVerbosity: "high" })

  assert.equal(preferences.hasOverride("session-a", "transport"), false)
  assert.equal(preferences.hasOverride("session-b", "transport"), true)
  assert.equal(preferences.hasOverride("session-b", "reasoningSummary"), false)

  assert.deepEqual(preferences.replaceDefaults({
    fast: false,
    transport: "websocket",
    textVerbosity: "medium",
    reasoningSummary: "concise",
  }), {
    fast: false,
    transport: "websocket",
    textVerbosity: "medium",
    reasoningSummary: "concise",
  })
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: true,
    transport: "websocket",
    textVerbosity: "medium",
    reasoningSummary: "concise",
  })
  assert.deepEqual(preferences.resolve("session-b"), {
    fast: false,
    transport: "sse",
    textVerbosity: "high",
    reasoningSummary: "concise",
  })
  assert.deepEqual(preferences.resolve("session-c"), {
    fast: false,
    transport: "websocket",
    textVerbosity: "medium",
    reasoningSummary: "concise",
  })

  preferences.remove("session-a")
  assert.deepEqual(preferences.resolve("session-a"), preferences.resolve("session-c"))

  const before = preferences.resolve("session-b")
  assert.throws(() => preferences.replaceDefaults({
    fast: "yes",
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  }), /fast/u)
  assert.deepEqual(preferences.resolve("session-b"), before)
  assert.throws(() => preferences.replaceDefaults({
    fast: false,
    transport: "auto",
    textVerbosity: "low",
  }), /defaults/u)
  assert.throws(() => preferences.hasOverride("session-b", "unknown"), /preference key/u)
})

test("session preferences reject ambiguous or unbounded input", () => {
  const preferences = createSessionPreferences({ maxSessions: 1 })

  assert.throws(() => preferences.configure("", { fast: true }), /session id/u)
  assert.throws(() => preferences.configure("x".repeat(257), { fast: true }), /session id/u)
  assert.throws(() => preferences.configure("session-a", {}), /preference/u)
  assert.throws(() => preferences.configure("session-a", { fast: "yes" }), /fast/u)
  assert.throws(() => preferences.configure("session-a", { transport: "udp" }), /transport/u)
  assert.throws(
    () => preferences.configure("session-a", { textVerbosity: "verbose" }),
    /textVerbosity/u,
  )
  assert.throws(
    () => preferences.configure("session-a", { reasoningSummary: "full" }),
    /reasoningSummary/u,
  )
  assert.throws(() => preferences.configure("session-a", { fast: true, extra: true }), /preference/u)
  assert.throws(() => createSessionPreferences({ defaultTextVerbosity: "verbose" }), /textVerbosity/u)
  assert.throws(() => createSessionPreferences({ defaultReasoningSummary: "full" }), /reasoningSummary/u)

  preferences.configure("session-a", { fast: true })
  assert.throws(() => preferences.configure("session-b", { fast: true }), /capacity/u)
})

test("session preference snapshots are immutable and disposal closes writes", () => {
  const preferences = createSessionPreferences()
  const snapshot = preferences.configure("session-a", {
    fast: true,
    transport: "websocket-cached",
    textVerbosity: "medium",
    reasoningSummary: "off",
  })

  assert.equal(Object.isFrozen(snapshot), true)
  assert.throws(() => {
    snapshot.fast = false
  }, TypeError)

  preferences.dispose()
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.throws(() => preferences.configure("session-a", { fast: false }), /disposed/u)
  assert.throws(() => preferences.replaceDefaults({
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  }), /disposed/u)
})
