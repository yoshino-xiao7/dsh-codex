import assert from "node:assert/strict"
import test from "node:test"

import {
  closeOpenAICodexWebSocketSessions,
  getOpenAICodexWebSocketDebugStats,
  resetOpenAICodexWebSocketDebugStats,
} from "@earendil-works/pi-ai/api/openai-codex-responses"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"

import {
  createCodexPiProvider,
  withCodexTransportLease,
} from "../src/internal/codex-pi-provider.mjs"
import {
  codexTransportHealth,
  codexTransportSessionId,
  createCodexSessionResourceManager,
} from "../src/internal/codex-session-resources.mjs"
import { apply } from "../src/host/index.mjs"

test("transport session ids are plugin-namespaced while preference ids stay unchanged", () => {
  const manager = createCodexSessionResourceManager()

  assert.equal(codexTransportSessionId(undefined), undefined)
  assert.equal(codexTransportSessionId("session-a"), "dsh-codex:session-a")
  assert.match(
    manager.transportSessionId("session-a"),
    /^dsh-codex:e:[0-9a-f]{32}:g:0:session-a$/u,
  )
  assert.throws(() => manager.transportSessionId("x".repeat(257)), /1 to 256/u)

  manager.dispose()
})

test("transport health exposes only safe counters and never raw debug details", async () => {
  const sessionId = "session-health-probe"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const manager = createCodexSessionResourceManager()
  const transportSessionId = manager.transportSessionId(sessionId)
  const provider = createCodexPiProvider({
    resolveTransportSessionId: (rawSessionId) => manager.transportSessionId(rawSessionId),
  })
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "sensitive websocket probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    assert.deepEqual(manager.transportHealth(sessionId), { status: "idle" })
    await failOneWebSocketRequest(sessionId, provider)
    const health = manager.transportHealth(sessionId)
    assert.equal(health.status, "observed")
    // pi-ai records a connection failure before a response.create request is sent.
    assert.equal(health.requests, 0)
    assert.equal(health.websocketFailures, 1)
    assert.equal(health.sseFallbacks, 1)
    assert.equal(health.websocketFallbackActive, true)
    assert.deepEqual(codexTransportHealth(sessionId), { status: "idle" })
    assert.deepEqual(Object.keys(health).sort(), [
      "cachedContextRequests",
      "connectionsCreated",
      "connectionsReused",
      "deltaRequests",
      "fullContextRequests",
      "requests",
      "sseFallbacks",
      "status",
      "websocketFailures",
      "websocketFallbackActive",
    ].sort())
    assert.equal(JSON.stringify(health).includes("sensitive"), false)
    assert.equal(JSON.stringify(health).includes("lastPreviousResponseId"), false)
    assert.equal(JSON.stringify(health).includes("lastWebSocketError"), false)
  } finally {
    manager.dispose()
    closeOpenAICodexWebSocketSessions(transportSessionId)
    resetOpenAICodexWebSocketDebugStats(transportSessionId)
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("reset closes and clears public pi-ai WebSocket state for one session", async () => {
  const sessionId = "session-reset-probe"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const manager = createCodexSessionResourceManager()
  const transportSessionId = manager.transportSessionId(sessionId)
  let nextTransportSessionId
  const provider = createCodexPiProvider({
    resolveTransportSessionId: (rawSessionId) => manager.transportSessionId(rawSessionId),
  })
  FakeWebSocket.created = 0
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    await failOneWebSocketRequest(sessionId, provider)
    assert.equal(FakeWebSocket.created, 1)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(transportSessionId)?.websocketFallbackActive,
      true,
    )

    manager.reset(sessionId)
    assert.equal(getOpenAICodexWebSocketDebugStats(transportSessionId), undefined)
    nextTransportSessionId = manager.transportSessionId(sessionId)
    assert.notEqual(nextTransportSessionId, transportSessionId)

    await failOneWebSocketRequest(sessionId, provider)
    assert.equal(FakeWebSocket.created, 2)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(nextTransportSessionId)?.websocketFallbackActive,
      true,
    )
  } finally {
    manager.dispose()
    for (const ownedSessionId of [transportSessionId, nextTransportSessionId]) {
      if (ownedSessionId === undefined) continue
      closeOpenAICodexWebSocketSessions(ownedSessionId)
      resetOpenAICodexWebSocketDebugStats(ownedSessionId)
    }
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("an inherited default rollover drops a real fallback latch without touching explicit sessions", async () => {
  const inheritedSession = `session-inherited-rollover-${"i".repeat(96)}`
  const explicitSession = "session-explicit-rollover"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const manager = createCodexSessionResourceManager()
  const inheritedProvider = createCodexPiProvider({
    acquireTransportSession: (sessionId) => manager.acquire(sessionId, {
      inheritsDefault: true,
    }),
    resolveSessionPreferences: () => ({
      fast: false,
      reasoningSummary: "auto",
      textVerbosity: "low",
      transport: "websocket",
    }),
  })
  const explicitProvider = createCodexPiProvider({
    acquireTransportSession: (sessionId) => manager.acquire(sessionId, {
      inheritsDefault: false,
    }),
    resolveSessionPreferences: () => ({
      fast: false,
      reasoningSummary: "auto",
      textVerbosity: "low",
      transport: "websocket",
    }),
  })
  FakeWebSocket.created = 0
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    const inheritedBefore = manager.transportSessionId(inheritedSession)
    const explicitBefore = manager.transportSessionId(explicitSession)
    await failOneWebSocketRequest(inheritedSession, inheritedProvider)
    await failOneWebSocketRequest(explicitSession, explicitProvider)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(inheritedBefore)?.websocketFallbackActive,
      true,
    )
    assert.equal(
      getOpenAICodexWebSocketDebugStats(explicitBefore)?.websocketFallbackActive,
      true,
    )

    manager.rolloverInherited()
    const inheritedAfter = manager.transportSessionId(inheritedSession)
    const explicitAfter = manager.transportSessionId(explicitSession)

    assert.notEqual(inheritedAfter, inheritedBefore)
    assert.notEqual(inheritedAfter.slice(0, 64), inheritedBefore.slice(0, 64))
    assert.equal(getOpenAICodexWebSocketDebugStats(inheritedBefore), undefined)
    assert.deepEqual(manager.transportHealth(inheritedSession), { status: "idle" })
    assert.equal(explicitAfter, explicitBefore)
    assert.equal(
      manager.transportHealth(explicitSession).websocketFallbackActive,
      true,
    )

    await failOneWebSocketRequest(inheritedSession, inheritedProvider)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(inheritedAfter)?.websocketFallbackActive,
      true,
    )
  } finally {
    manager.dispose()
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("manager epochs isolate a replacement from an old generation that drains late", async () => {
  const sessionId = `session-manager-hot-replacement-${"x".repeat(96)}`
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const oldManager = createCodexSessionResourceManager()
  const replacementManager = createCodexSessionResourceManager()
  const oldProvider = fallbackProviderForManager(oldManager)
  const replacementProvider = fallbackProviderForManager(replacementManager)
  let retained
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    await failOneWebSocketRequest(sessionId, oldProvider)
    const oldSessionId = oldManager.transportSessionId(sessionId)
    retained = oldManager.acquire(sessionId, { inheritsDefault: true })
    oldManager.dispose()
    assert.equal(
      getOpenAICodexWebSocketDebugStats(oldSessionId)?.websocketFallbackActive,
      true,
    )

    const replacementSessionId = replacementManager.transportSessionId(sessionId)
    assert.match(oldSessionId, /^dsh-codex:e:[0-9a-f]{32}:g:0:/u)
    assert.match(replacementSessionId, /^dsh-codex:e:[0-9a-f]{32}:g:0:/u)
    assert.notEqual(replacementSessionId, oldSessionId)
    assert.notEqual(replacementSessionId.slice(0, 64), oldSessionId.slice(0, 64))

    await failOneWebSocketRequest(sessionId, replacementProvider)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(replacementSessionId)?.websocketFallbackActive,
      true,
    )

    retained.release()
    retained = undefined
    assert.equal(getOpenAICodexWebSocketDebugStats(oldSessionId), undefined)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(replacementSessionId)?.websocketFallbackActive,
      true,
    )
  } finally {
    retained?.release()
    oldManager.dispose()
    replacementManager.dispose()
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("an old manager cannot dispose an unknown session owned by its replacement", async () => {
  const sessionId = "session-unknown-owner-hot-replacement"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const oldManager = createCodexSessionResourceManager()
  const replacementManager = createCodexSessionResourceManager()
  const replacementProvider = fallbackProviderForManager(replacementManager)
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    const replacementSessionId = replacementManager.transportSessionId(sessionId)
    await failOneWebSocketRequest(sessionId, replacementProvider)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(replacementSessionId)?.websocketFallbackActive,
      true,
    )

    oldManager.disposeSession(sessionId)
    oldManager.dispose()

    assert.equal(
      getOpenAICodexWebSocketDebugStats(replacementSessionId)?.websocketFallbackActive,
      true,
    )
  } finally {
    oldManager.dispose()
    replacementManager.dispose()
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("rollover waits for pending next, return, and tracked stream completion before cleanup", async () => {
  const sessionId = "session-active-generation"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const manager = createCodexSessionResourceManager()
  const provider = createCodexPiProvider({
    acquireTransportSession: (rawSessionId) => manager.acquire(rawSessionId, {
      inheritsDefault: true,
    }),
    resolveSessionPreferences: () => ({
      fast: false,
      reasoningSummary: "auto",
      textVerbosity: "low",
      transport: "websocket",
    }),
  })
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    await failOneWebSocketRequest(sessionId, provider)
    const oldSessionId = manager.transportSessionId(sessionId)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(oldSessionId)?.websocketFallbackActive,
      true,
    )

    const next = deferred()
    const returned = deferred()
    const result = deferred()
    const lease = manager.acquire(sessionId, { inheritsDefault: true })
    const stream = withCodexTransportLease({
      result: () => result.promise,
      [Symbol.asyncIterator]() {
        return {
          next: () => next.promise,
          return: () => returned.promise,
        }
      },
    }, lease)
    const iterator = stream[Symbol.asyncIterator]()
    const pendingNext = iterator.next()

    manager.rolloverInherited()
    const newSessionId = manager.transportSessionId(sessionId)
    assert.notEqual(newSessionId, oldSessionId)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(oldSessionId)?.websocketFallbackActive,
      true,
    )
    assert.deepEqual(manager.transportHealth(sessionId), { status: "idle" })

    const pendingReturn = iterator.return()
    next.resolve({ done: false, value: "partial" })
    await pendingNext
    returned.resolve({ done: true, value: undefined })
    await pendingReturn
    assert.equal(
      getOpenAICodexWebSocketDebugStats(oldSessionId)?.websocketFallbackActive,
      true,
    )

    result.resolve({ stopReason: "aborted" })
    await Promise.resolve()
    assert.equal(getOpenAICodexWebSocketDebugStats(oldSessionId), undefined)
  } finally {
    manager.dispose()
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("tracked completion prevents early cleanup when iterator return is absent or rejects", async () => {
  for (const returnBehavior of ["absent", "reject"]) {
    const manager = createCodexSessionResourceManager({ maxSessions: 1 })
    const sessionId = `session-return-${returnBehavior}`
    const result = deferred()
    const iterator = {
      next: async () => ({ done: false, value: "partial" }),
      ...(returnBehavior === "reject"
        ? { return: async () => { throw new Error("teardown rejected") } }
        : {}),
    }
    const lease = manager.acquire(sessionId, { inheritsDefault: true })
    const oldSessionId = lease.sessionId
    const stream = withCodexTransportLease({
      result: () => result.promise,
      [Symbol.asyncIterator]: () => iterator,
    }, lease)
    const leasedIterator = stream[Symbol.asyncIterator]()

    manager.reset(sessionId)
    const newSessionId = manager.transportSessionId(sessionId)
    assert.notEqual(newSessionId, oldSessionId)
    assert.throws(
      () => manager.acquire("other", { inheritsDefault: true }),
      /capacity/u,
    )
    if (returnBehavior === "reject") {
      await assert.rejects(leasedIterator.return(), /teardown rejected/u)
    } else {
      assert.deepEqual(await leasedIterator.return(), { done: true, value: undefined })
    }
    assert.throws(
      () => manager.acquire("other", { inheritsDefault: true }),
      /capacity/u,
    )

    result.resolve({ stopReason: "aborted" })
    await Promise.resolve()
    manager.acquire("other", { inheritsDefault: true }).release()
    manager.dispose()
  }
})

test("lease wrapper contains concurrent next and teardown errors and releases exactly once", async () => {
  const next = deferred()
  let releaseCalls = 0
  const stream = withCodexTransportLease({
    [Symbol.asyncIterator]() {
      return {
        next: () => next.promise,
        return: async () => { throw new Error("return failed") },
      }
    },
  }, {
    sessionId: "dsh-codex:lease-error-race",
    release() {
      releaseCalls += 1
    },
  })
  const iterator = stream[Symbol.asyncIterator]()
  const pendingNext = iterator.next()

  await assert.rejects(iterator.return(), /return failed/u)
  assert.equal(releaseCalls, 0)
  next.reject(new Error("next failed"))
  await assert.rejects(pendingNext, /next failed/u)
  assert.equal(releaseCalls, 1)
  await assert.rejects(iterator.return(), /return failed/u)
  assert.equal(releaseCalls, 1)
})

test("runtime disposal retires active transport generations and drains them after release", async () => {
  const manager = createCodexSessionResourceManager()
  const lease = manager.acquire("session-runtime-drain", { inheritsDefault: true })
  const firstSessionId = lease.sessionId

  manager.dispose()
  assert.throws(() => manager.acquire("new-session"), /disposed/u)
  assert.doesNotThrow(() => lease.release())
  assert.equal(getOpenAICodexWebSocketDebugStats(firstSessionId), undefined)
})

test("agent disposal lets an active generation drain and safely revives the same logical id", () => {
  const manager = createCodexSessionResourceManager({ maxSessions: 1 })
  const active = manager.acquire("session-reused-agent-id", { inheritsDefault: true })

  manager.disposeSession("session-reused-agent-id")
  const revived = manager.acquire("session-reused-agent-id", { inheritsDefault: true })
  assert.notEqual(revived.sessionId, active.sessionId)
  assert.match(revived.sessionId, /^dsh-codex:e:[0-9a-f]{32}:g:1:/u)
  assert.throws(
    () => manager.acquire("other-session", { inheritsDefault: true }),
    /capacity/u,
  )

  active.release()
  revived.release()
  manager.disposeSession("session-reused-agent-id")
  manager.acquire("other-session", { inheritsDefault: true }).release()
  manager.dispose()
})

test("agent disposal drops the fallback latch before the next request", async () => {
  const sessionId = "session-agent-dispose-probe"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const host = hostFixture()
  FakeWebSocket.created = 0
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    apply(host.ctx, {})
    await failOneHostWebSocketRequest(host, sessionId)
    assert.equal(FakeWebSocket.created, 1)

    host.listeners.find(({ event }) => event === "agent/disposed")
      .listener({ agent: { id: sessionId } })

    await failOneHostWebSocketRequest(host, sessionId)
    assert.equal(FakeWebSocket.created, 2)
  } finally {
    for (const dispose of host.effects.toReversed()) dispose?.()
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("host /codex reset drops the fallback latch before the next request", async () => {
  const sessionId = "session-command-reset-probe"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const host = hostFixture()
  FakeWebSocket.created = 0
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    apply(host.ctx, {})
    const commands = []
    host.injections.find(({ services }) => services[0] === "commands").callback({
      commands: { register: (definition) => commands.push(definition) },
      authorization: { describe: () => undefined, cancel: () => undefined },
      credentials: {
        describeRecord: async () => ({ configured: false, writable: true }),
        deleteRecord: async () => undefined,
      },
    })
    await failOneHostWebSocketRequest(host, sessionId)
    assert.equal(FakeWebSocket.created, 1)

    const result = await commands.find(({ name }) => name === "codex")
      .handler({ rawInput: "reset", agent: { id: sessionId } })

    assert.equal(result.kind, "success")
    await failOneHostWebSocketRequest(host, sessionId)
    assert.equal(FakeWebSocket.created, 2)
  } finally {
    for (const dispose of host.effects.toReversed()) dispose?.()
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("host disposal converges after plugin-owned fallback state", async () => {
  const sessionId = "session-runtime-dispose-probe"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const host = hostFixture()
  FakeWebSocket.created = 0
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    apply(host.ctx, {})
    await failOneHostWebSocketRequest(host, sessionId)
    assert.equal(FakeWebSocket.created, 1)

    for (const dispose of host.effects.toReversed()) dispose?.()
    host.effects.length = 0
  } finally {
    for (const dispose of host.effects.toReversed()) dispose?.()
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("plugin disposal leaves an external pi-ai session with the same raw id intact", async () => {
  const sessionId = "session-external-isolation-probe"
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const manager = createCodexSessionResourceManager()
  const transportSessionId = manager.transportSessionId(sessionId)
  const pluginProvider = createCodexPiProvider({
    resolveTransportSessionId: (rawSessionId) => (
      manager.transportSessionId(rawSessionId)
    ),
  })
  const externalProvider = openaiCodexProvider()
  FakeWebSocket.created = 0
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    await failOneWebSocketRequest(sessionId, pluginProvider)
    await failOneWebSocketRequest(sessionId, externalProvider)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(transportSessionId)?.websocketFallbackActive,
      true,
    )
    assert.equal(
      getOpenAICodexWebSocketDebugStats(sessionId)?.websocketFallbackActive,
      true,
    )

    manager.dispose()

    assert.equal(getOpenAICodexWebSocketDebugStats(transportSessionId), undefined)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(sessionId)?.websocketFallbackActive,
      true,
    )
  } finally {
    manager.dispose()
    for (const ownedSessionId of [sessionId, transportSessionId]) {
      closeOpenAICodexWebSocketSessions(ownedSessionId)
      resetOpenAICodexWebSocketDebugStats(ownedSessionId)
    }
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, reject, resolve }
}

class FakeWebSocket {
  static created = 0

  constructor() {
    this.listeners = new Map()
    this.readyState = 0
    FakeWebSocket.created += 1
    queueMicrotask(() => {
      this.#emit("close", { code: 1006, reason: "probe", wasClean: false })
    })
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
    )
  }

  send() {}

  close() {
    this.readyState = 3
  }

  #emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

async function failOneWebSocketRequest(
  sessionId,
  provider = createCodexPiProvider(),
) {
  const model = provider.getModels().find(({ id }) => id === "gpt-5.4")
    ?? provider.getModels()[0]
  const stream = provider.streamSimple(model, {
    systemPrompt: "system",
    messages: [{ role: "user", content: "probe", timestamp: 1 }],
    tools: [],
  }, {
    apiKey: fakeAccessToken(),
    transport: "websocket",
    sessionId,
    maxRetries: 0,
  })
  for await (const _event of stream) {
    // Exhaust the public stream so its session fallback state is committed.
  }
}

function fallbackProviderForManager(manager) {
  return createCodexPiProvider({
    acquireTransportSession: (sessionId) => manager.acquire(sessionId, {
      inheritsDefault: true,
    }),
    resolveSessionPreferences: () => ({
      fast: false,
      reasoningSummary: "auto",
      textVerbosity: "low",
      transport: "websocket",
    }),
  })
}

function fakeAccessToken() {
  const claims = {
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-probe" },
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `e30.${payload}.probe`
}

async function failOneHostWebSocketRequest(host, sessionId) {
  const adapter = host.adapters[0]
  const model = (await adapter.listModels("dsh-codex"))[0]
  for await (const _chunk of adapter.stream({
    provider: "dsh-codex",
    model: model.id,
    sessionId,
    messages: [{
      role: "user",
      content: [{ type: "text", text: "probe" }],
      source: { kind: "user" },
    }],
  })) {
    // Exhaust the adapter stream so pi-ai commits its session fallback state.
  }
}

function hostFixture() {
  const listeners = []
  const effects = []
  const injections = []
  const adapters = []
  const credential = Object.freeze({
    type: "oauth",
    access: fakeAccessToken(),
    refresh: "refresh-probe",
    expires: Date.now() + 10 * 60_000,
  })
  const ctx = {
    fiber: { state: 0 },
    logger: { warn() {} },
    credentials: {
      readRecord: async () => ({ kind: "grant", payload: credential }),
      describeRecord: async () => ({ configured: true, kind: "grant", writable: true }),
      modifyRecord: async (_key, mutate) => (
        (await mutate({ kind: "grant", payload: credential }))
        ?? { kind: "grant", payload: credential }
      ),
      deleteRecord: async () => undefined,
    },
    authorization: {
      registerFlow: () => () => undefined,
    },
    llm: {
      registerAdapter(_routes, adapter) {
        adapters.push(adapter)
        const dispose = () => undefined
        dispose.replace = () => undefined
        return dispose
      },
      registerModelDiscovery: () => () => undefined,
    },
    get: () => undefined,
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
      injections.push({ services, callback })
    },
  }
  return { ctx, listeners, effects, injections, adapters }
}
