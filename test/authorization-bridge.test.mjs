import assert from "node:assert/strict"
import test from "node:test"

import { AuthorizationDeclinedError } from "@deepseek-ai/dsh-authorization"

import {
  AUTHORIZATION_RPC_CHANNEL,
  CODEX_AUTHORIZATION_KEY,
  CodexAuthorizationBridge,
  createAuthorizationRpcHandler,
  installAuthorizationRpc,
  registerCodexLoginCommand,
  registerCodexUsageCommand,
} from "../src/internal/authorization-bridge.mjs"

const STORED_SECRET = "stored-token-must-never-cross-rpc"
const PROMPT_SECRET = "prompt-answer-must-never-enter-events"

test("authorization bridge bounds interaction data and never exposes stored or entered secrets", async () => {
  let receivedAnswer
  let readRecordCalls = 0
  const authorization = {
    describe: () => ({
      key: CODEX_AUTHORIZATION_KEY,
      label: "Codex",
      methods: [{ id: "oauth", label: "ChatGPT" }],
      inFlight: false,
    }),
    cancel: () => undefined,
    async begin({ interaction }) {
      interaction.notify({
        message: "m".repeat(3_000),
        url: "javascript:alert(1)",
        code: "c".repeat(400),
      })
      interaction.notify({ message: "Open the local callback", url: "http://127.0.0.1:3456/callback" })
      for (let index = 0; index < 60; index += 1) {
        interaction.notify({ message: `bounded notice ${index}` })
      }
      const selected = await interaction.prompt({
        kind: "select",
        message: "p".repeat(3_000),
        options: Array.from({ length: 80 }, (_, index) => ({
          id: `provider-option-${index}`,
          label: `Option ${index}`,
          description: "d".repeat(3_000),
        })),
      })
      assert.equal(selected, "provider-option-0")
      receivedAnswer = await interaction.prompt({
        kind: "secret",
        message: "Enter a short-lived response",
        placeholder: "x".repeat(1_000),
      })
      return { status: "authorized" }
    },
  }
  const credentials = {
    async describeRecord() {
      void STORED_SECRET
      return { configured: true, kind: "grant", writable: true }
    },
    async deleteRecord() {},
    async readRecord() {
      readRecordCalls += 1
      return {
        kind: "grant",
        payload: {
          type: "oauth",
          access: STORED_SECRET,
          refresh: "refresh-fixture",
          expires: 4_102_444_800_000,
        },
      }
    },
  }
  const bridge = new CodexAuthorizationBridge({ authorization, credentials }, { waitMs: 50 })
  const handler = createAuthorizationRpcHandler(bridge)

  const described = await handler("status", {}, new AbortController().signal)
  assert.equal(described.ok, true)
  assert.equal(readRecordCalls, 1)
  assert.doesNotMatch(JSON.stringify(described), new RegExp(STORED_SECRET, "u"))

  const started = await handler("start", { method: "oauth" }, new AbortController().signal)
  assert.equal(started.ok, true)
  const attemptId = started.value.attemptId
  const firstPage = await bridge.status({ attemptId, after: 0 })
  assert.ok(firstPage.events.length <= 33)
  const firstNotice = firstPage.events.find((event) => event.type === "notice")
  assert.equal(firstNotice.notice.message.length, 2_048)
  assert.equal(firstNotice.notice.code.length, 256)
  assert.equal("url" in firstNotice.notice, false)
  const localNotice = firstPage.events.find((event) => event.type === "notice" && event.notice.url !== undefined)
  assert.equal(localNotice.notice.url, "http://127.0.0.1:3456/callback")
  const selectEvent = firstPage.events.find((event) => event.type === "prompt")
  assert.equal(selectEvent.prompt.message.length, 2_048)
  assert.equal(selectEvent.prompt.options.length, 64)
  assert.equal(selectEvent.prompt.options[0].id, "option-1")
  assert.equal(selectEvent.prompt.options[0].description.length, 2_048)

  const selectReply = await handler("respond", {
    attemptId,
    promptId: selectEvent.promptId,
    action: "answer",
    value: "option-1",
  }, new AbortController().signal)
  assert.deepEqual(selectReply, { ok: true, value: { accepted: true } })

  const secondPage = await bridge.status({ attemptId, after: firstPage.nextSeq })
  const secretEvent = secondPage.events.find((event) => event.type === "prompt")
  assert.equal(secretEvent.prompt.kind, "secret")
  assert.equal(secretEvent.prompt.placeholder.length, 512)

  const oversized = await handler("respond", {
    attemptId,
    promptId: secretEvent.promptId,
    action: "answer",
    value: "x".repeat(16_385),
  }, new AbortController().signal)
  assert.equal(oversized.ok, false)
  assert.equal(oversized.error.code, "bad-request")

  const answer = await handler("respond", {
    attemptId,
    promptId: secretEvent.promptId,
    action: "answer",
    value: PROMPT_SECRET,
  }, new AbortController().signal)
  assert.deepEqual(answer, { ok: true, value: { accepted: true } })
  const terminal = await waitUntilDone(bridge, attemptId, secondPage.nextSeq)
  assert.equal(terminal.done, true)
  assert.equal(terminal.events.at(-1).status, "authorized")
  assert.equal(receivedAnswer, PROMPT_SECRET)

  const allRpcOutput = JSON.stringify([described, started, firstPage, secondPage, oversized, answer, terminal])
  assert.doesNotMatch(allRpcOutput, new RegExp(STORED_SECRET, "u"))
  assert.doesNotMatch(allRpcOutput, new RegExp(PROMPT_SECRET, "u"))
  bridge.dispose()
})

test("authorization status marks an incompatible stored record as invalid", async () => {
  const credentials = {
    async describeRecord() {
      return { configured: true, kind: "api-key", writable: true }
    },
    async readRecord() {
      return { kind: "api-key", payload: { key: STORED_SECRET } }
    },
    async deleteRecord() {},
  }
  const bridge = new CodexAuthorizationBridge({
    authorization: {
      describe: () => undefined,
      cancel: () => undefined,
    },
    credentials,
  })

  const status = await bridge.status()

  assert.deepEqual(status.credential, {
    configured: true,
    state: "invalid",
    kind: "api-key",
    writable: true,
  })
  assert.doesNotMatch(JSON.stringify(status), new RegExp(STORED_SECRET, "u"))
  bridge.dispose()
})

test("authorization status marks a malformed OAuth grant as invalid without exposing it", async () => {
  const credentials = {
    async describeRecord() {
      return { configured: true, kind: "grant", writable: true }
    },
    async readRecord() {
      return {
        kind: "grant",
        payload: { type: "oauth", access: STORED_SECRET, refresh: "", expires: -1 },
      }
    },
    async deleteRecord() {},
  }
  const bridge = new CodexAuthorizationBridge({
    authorization: {
      describe: () => undefined,
      cancel: () => undefined,
    },
    credentials,
  })

  const status = await bridge.status()

  assert.equal(status.credential.state, "invalid")
  assert.doesNotMatch(JSON.stringify(status), new RegExp(STORED_SECRET, "u"))
  bridge.dispose()
})

test("decline and cancel preserve authorization seam semantics", async () => {
  let cancellationSignal
  const cancelledKeys = []
  let mode = "decline"
  const authorization = {
    describe: () => ({
      label: "Codex",
      methods: [{ id: "oauth", label: "ChatGPT" }],
      inFlight: false,
    }),
    cancel: (key) => cancelledKeys.push(key),
    async begin({ interaction, signal }) {
      if (mode === "decline") {
        try {
          await interaction.prompt({ kind: "text", message: "Continue?" })
        } catch (error) {
          assert.ok(error instanceof AuthorizationDeclinedError)
          return { status: "cancelled" }
        }
      }
      cancellationSignal = signal
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      return { status: "cancelled" }
    },
  }
  const credentials = {
    describeRecord: async () => ({ configured: false, writable: true }),
    deleteRecord: async () => undefined,
  }
  const bridge = new CodexAuthorizationBridge({ authorization, credentials }, { waitMs: 50 })

  const declinedStart = await bridge.start({})
  const promptPage = await bridge.status({ attemptId: declinedStart.attemptId, after: 0 })
  const prompt = promptPage.events.find((event) => event.type === "prompt")
  bridge.respond({
    attemptId: declinedStart.attemptId,
    promptId: prompt.promptId,
    action: "decline",
  })
  const declinedEnd = await waitUntilDone(bridge, declinedStart.attemptId, promptPage.nextSeq)
  assert.equal(declinedEnd.events.at(-1).status, "cancelled")

  mode = "cancel"
  const cancelledStart = await bridge.start({})
  await Promise.resolve()
  assert.equal(cancellationSignal.aborted, false)
  assert.deepEqual(bridge.cancel({ attemptId: cancelledStart.attemptId }), { accepted: true })
  assert.equal(cancellationSignal.aborted, true)
  const cancelledEnd = await waitUntilDone(bridge, cancelledStart.attemptId, 0)
  assert.equal(cancelledEnd.events.at(-1).status, "cancelled")
  assert.ok(cancelledKeys.every((key) => key === CODEX_AUTHORIZATION_KEY))
  bridge.dispose()
})

test("bridge bounds concurrent attempts and long-poll waiters", async () => {
  const sessions = []
  const authorization = {
    describe: () => ({
      label: "Codex",
      methods: [{ id: "oauth", label: "ChatGPT" }],
      inFlight: false,
    }),
    cancel: () => undefined,
    begin: ({ interaction, signal }) => new Promise((resolve) => {
      sessions.push(interaction)
      signal.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true })
    }),
  }
  const credentials = {
    describeRecord: async () => ({ configured: false, writable: true }),
    deleteRecord: async () => undefined,
  }
  const bridge = new CodexAuthorizationBridge({ authorization, credentials }, { waitMs: 1_000 })

  const starts = []
  for (let index = 0; index < 8; index += 1) starts.push(await bridge.start({}))
  await assert.rejects(() => bridge.start({}), /Too many authorization attempts/u)
  await Promise.resolve()

  const attemptId = starts[0].attemptId
  const waits = Array.from({ length: 8 }, () => bridge.status({ attemptId, after: 0 }))
  await assert.rejects(
    () => bridge.status({ attemptId, after: 0 }),
    /Too many status waiters/u,
  )
  sessions[0].notify({ message: "wake" })
  const pages = await Promise.all(waits)
  assert.ok(pages.every((page) => page.events.length === 1))

  bridge.cancel({ attemptId: starts[7].attemptId })
  const settled = await waitUntilDone(bridge, starts[7].attemptId, 0)
  assert.equal(settled.done, true)
  const replacement = await bridge.start({})
  assert.notEqual(replacement.attemptId, starts[7].attemptId)
  bridge.dispose()
})

test("a pre-aborted provider prompt settles instead of hanging", async () => {
  const promptController = new AbortController()
  promptController.abort("withdrawn before prompt registration")
  const authorization = {
    describe: () => ({
      label: "Codex",
      methods: [{ id: "oauth", label: "ChatGPT" }],
      inFlight: false,
    }),
    cancel: () => undefined,
    async begin({ interaction }) {
      await interaction.prompt({
        kind: "text",
        message: "Continue?",
        signal: promptController.signal,
      })
      return { status: "authorized" }
    },
  }
  const credentials = {
    describeRecord: async () => ({ configured: false, writable: true }),
    deleteRecord: async () => undefined,
  }
  const bridge = new CodexAuthorizationBridge({ authorization, credentials }, { waitMs: 50 })
  const started = await bridge.start({})
  const terminal = await waitUntilDone(bridge, started.attemptId, 0)

  assert.equal(terminal.done, true)
  assert.equal(terminal.events.at(-1).type, "failed")
  bridge.dispose()
})

test("starting a new flow does not delete an unread retained terminal event", async () => {
  const authorization = {
    describe: () => ({
      label: "Codex",
      methods: [{ id: "oauth", label: "ChatGPT" }],
      inFlight: false,
    }),
    cancel: () => undefined,
    begin: async () => ({ status: "authorized" }),
  }
  const credentials = {
    describeRecord: async () => ({ configured: false, writable: true }),
    deleteRecord: async () => undefined,
  }
  const bridge = new CodexAuthorizationBridge(
    { authorization, credentials },
    { retentionMs: 5_000, waitMs: 50 },
  )
  const first = await bridge.start({})
  const firstTerminal = await waitUntilDone(bridge, first.attemptId, 0)
  assert.equal(firstTerminal.done, true)

  await bridge.start({})
  const retained = await bridge.status({ attemptId: first.attemptId, after: 0 })
  assert.equal(retained.done, true)
  assert.equal(retained.events.at(-1).status, "authorized")
  bridge.dispose()
})

test("a retained terminal attempt id cannot cancel a newer authorization attempt", async () => {
  let beginCount = 0
  let cancelCalls = 0
  let cancelCurrent
  let currentSignal
  let markCurrentStarted
  const currentStarted = new Promise((resolve) => { markCurrentStarted = resolve })
  const authorization = {
    describe: () => ({
      label: "Codex",
      methods: [{ id: "oauth", label: "ChatGPT" }],
      inFlight: false,
    }),
    cancel() {
      cancelCalls += 1
      cancelCurrent?.()
    },
    async begin({ signal }) {
      beginCount += 1
      if (beginCount === 1) return { status: "authorized" }
      currentSignal = signal
      markCurrentStarted()
      return new Promise((resolve) => {
        cancelCurrent = () => resolve({ status: "cancelled" })
      })
    },
  }
  const credentials = {
    describeRecord: async () => ({ configured: false, writable: true }),
    deleteRecord: async () => undefined,
  }
  const bridge = new CodexAuthorizationBridge(
    { authorization, credentials },
    { retentionMs: 5_000, waitMs: 20 },
  )
  const old = await bridge.start({})
  await waitUntilDone(bridge, old.attemptId, 0)
  const current = await bridge.start({})
  await currentStarted

  assert.deepEqual(bridge.cancel({ attemptId: old.attemptId }), { accepted: false })
  assert.equal(cancelCalls, 0)
  assert.equal(currentSignal.aborted, false)

  assert.deepEqual(bridge.cancel({ attemptId: current.attemptId }), { accepted: true })
  await waitUntilDone(bridge, current.attemptId, 0)
  bridge.dispose()
})

test("loopback RPC and explicit logout use only the public credentials deletion seam", async () => {
  const registrations = []
  const effects = []
  const deleted = []
  const context = {
    authorization: {
      describe: () => undefined,
      begin: async () => ({ status: "cancelled" }),
      cancel: () => undefined,
    },
    credentials: {
      describeRecord: async () => ({ configured: false, writable: true }),
      deleteRecord: async (key) => deleted.push(key),
    },
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registrations.push({ channel, handler, options })
        },
      },
    },
    effect(callback) {
      effects.push(callback())
    },
  }

  installAuthorizationRpc(context, { waitMs: 20 })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].channel, AUTHORIZATION_RPC_CHANNEL)
  assert.deepEqual(registrations[0].options, { authority: "loopback" })
  assert.deepEqual(deleted, [])

  const logout = await registrations[0].handler("logout", {}, new AbortController().signal)
  assert.deepEqual(logout, { ok: true, value: { signedOut: true } })
  assert.deepEqual(deleted, [CODEX_AUTHORIZATION_KEY])
  effects[0]?.()
})

test("codex-login command records no input and returns only durable-safe bilingual summaries", async () => {
  let command
  const deleted = []
  const context = {
    commands: { register: (spec) => { command = spec } },
    authorization: {
      describe: () => ({ inFlight: false }),
      cancel: () => undefined,
    },
    credentials: {
      describeRecord: async () => ({ configured: true, kind: "grant", writable: true }),
      readRecord: async () => ({
        kind: "grant",
        payload: {
          type: "oauth",
          access: STORED_SECRET,
          refresh: "refresh-fixture",
          expires: 4_102_444_800_000,
        },
      }),
      deleteRecord: async (key) => deleted.push(key),
    },
  }
  registerCodexLoginCommand(context)

  assert.equal(command.name, "codex-login")
  assert.equal(command.recordInput, false)
  assert.equal(command.input.hint, "[status|cancel|logout]")
  const status = await command.handler({ rawInput: "status" })
  assert.match(status.text, /Codex is signed in/u)
  const invalid = await command.handler({ rawInput: PROMPT_SECRET })
  assert.equal(invalid.kind, "error")
  assert.doesNotMatch(invalid.text, new RegExp(PROMPT_SECRET, "u"))
  const logout = await command.handler({ rawInput: "logout" })
  assert.equal(logout.kind, "success")
  assert.deepEqual(deleted, [CODEX_AUTHORIZATION_KEY])

  context.credentials.deleteRecord = async () => { throw new Error(STORED_SECRET) }
  const failed = await command.handler({ rawInput: "logout" })
  assert.equal(failed.kind, "error")
  assert.doesNotMatch(failed.text, new RegExp(STORED_SECRET, "u"))
})

test("codex-login command refuses cancellation after credential commit starts", async () => {
  let command
  let cancelCalls = 0
  const context = {
    commands: { register: (spec) => { command = spec } },
    authorization: {
      cancel: () => { cancelCalls += 1 },
    },
  }
  registerCodexLoginCommand(context, {
    commitTracker: {
      tryCancel() {
        return false
      },
    },
  })

  const result = await command.handler({ rawInput: "cancel" })
  assert.equal(result.kind, "success")
  assert.match(result.text, /commit has started/u)
  assert.equal(cancelCalls, 0)
})

test("codex-usage reports only recent observations and rejects unknown input", async () => {
  let command
  const context = {
    commands: { register: (spec) => { command = spec } },
  }
  registerCodexUsageCommand(context, {
    snapshot: () => ({
      status: "exhausted",
      observedAt: Date.parse("2026-08-27T08:00:00.000Z"),
      resetAt: Date.parse("2026-08-27T08:44:34.000Z"),
    }),
  })

  assert.equal(command.name, "codex-usage")
  assert.equal(command.recordInput, false)
  assert.equal(command.input.hint, "[status]")
  const status = await command.handler({ rawInput: "status" })
  assert.equal(status.kind, "success")
  assert.match(status.text, /2026-08-27T08:44:34\.000Z/u)
  assert.doesNotMatch(status.text, /request id|token|secret/iu)

  const invalid = await command.handler({ rawInput: PROMPT_SECRET })
  assert.equal(invalid.kind, "error")
  assert.doesNotMatch(invalid.text, new RegExp(PROMPT_SECRET, "u"))
})

async function waitUntilDone(bridge, attemptId, after) {
  const events = []
  let nextSeq = after
  while (true) {
    const page = await bridge.status({ attemptId, after: nextSeq })
    events.push(...page.events)
    nextSeq = page.nextSeq
    if (page.done) return { ...page, events }
  }
}
