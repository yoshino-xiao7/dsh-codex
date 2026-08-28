import assert from "node:assert/strict"
import test from "node:test"

import { registerCodexSessionCommand } from "../src/internal/session-preference-command.mjs"
import { createSessionPreferences } from "../src/internal/session-preferences.mjs"

function commandFixture() {
  let definition
  const resets = []
  const preferences = createSessionPreferences()
  registerCodexSessionCommand({
    commands: {
      register(candidate) {
        definition = candidate
        return () => undefined
      },
    },
  }, preferences, {
    resetSession: (sessionId) => resets.push(sessionId),
  })
  const invoke = (rawInput, id = "session-a") => definition.handler({
    rawInput,
    agent: { id },
  })
  return { definition, invoke, preferences, resets }
}

test("/codex reports and changes Fast for only the receiving session", async () => {
  const { definition, invoke, preferences } = commandFixture()

  assert.equal(definition.name, "codex")
  assert.equal(definition.recordInput, false)
  assert.match((await invoke("status")).text, /Fast: off/u)

  const enabled = await invoke("set fast on")
  assert.equal(enabled.kind, "success")
  assert.match(enabled.text, /Fast: on/u)
  assert.deepEqual(preferences.resolve("session-a"), { fast: true, transport: "auto" })
  assert.deepEqual(preferences.resolve("session-b"), { fast: false, transport: "auto" })

  const disabled = await invoke("set fast off")
  assert.equal(disabled.kind, "success")
  assert.deepEqual(preferences.resolve("session-a"), { fast: false, transport: "auto" })
})

test("/codex controls the current session transport and supports reset", async () => {
  const { invoke, preferences, resets } = commandFixture()

  assert.equal((await invoke("set transport websocket-cached")).kind, "success")
  assert.deepEqual(preferences.resolve("session-a"), {
    fast: false,
    transport: "websocket-cached",
  })
  assert.match((await invoke("status")).text, /Transport: websocket-cached/u)

  assert.equal((await invoke("reset")).kind, "success")
  assert.deepEqual(preferences.resolve("session-a"), { fast: false, transport: "auto" })
  assert.deepEqual(resets, ["session-a"])
})

test("/codex rejects unknown input without changing session preferences", async () => {
  const { invoke, preferences } = commandFixture()

  for (const input of [
    "set",
    "set fast maybe",
    "set transport udp",
    "unknown",
    "status extra",
  ]) {
    const result = await invoke(input)
    assert.equal(result.kind, "error", input)
    assert.match(result.text, /\/codex/u)
  }
  assert.deepEqual(preferences.resolve("session-a"), { fast: false, transport: "auto" })
})

test("/codex contains preference-store failures", async () => {
  let definition
  registerCodexSessionCommand({
    commands: { register: (candidate) => { definition = candidate } },
  }, {
    resolve() { throw new Error("secret diagnostic") },
    configure() { throw new Error("secret diagnostic") },
    remove() { throw new Error("secret diagnostic") },
  })

  const status = await definition.handler({ rawInput: "status", agent: { id: "session-a" } })
  assert.equal(status.kind, "error")
  assert.equal(status.text.includes("secret diagnostic"), false)
})
