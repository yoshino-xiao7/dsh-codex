import assert from "node:assert/strict"
import test from "node:test"

import {
  closeOpenAICodexWebSocketSessions,
  getOpenAICodexWebSocketDebugStats,
  resetOpenAICodexWebSocketDebugStats,
} from "@earendil-works/pi-ai/api/openai-codex-responses"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"

import { createCodexPiProvider } from "../src/internal/codex-pi-provider.mjs"
import {
  codexTransportSessionId,
  createCodexSessionResourceManager,
} from "../src/internal/codex-session-resources.mjs"
import { apply } from "../src/host/index.mjs"

test("transport session ids are plugin-namespaced while preference ids stay unchanged", () => {
  const manager = createCodexSessionResourceManager()

  assert.equal(codexTransportSessionId(undefined), undefined)
  assert.equal(codexTransportSessionId("session-a"), "dsh-codex:session-a")
  assert.equal(manager.transportSessionId("session-a"), "dsh-codex:session-a")

  manager.dispose()
})

test("reset closes and clears public pi-ai WebSocket state for one session", async () => {
  const sessionId = "session-reset-probe"
  const transportSessionId = codexTransportSessionId(sessionId)
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const manager = createCodexSessionResourceManager()
  FakeWebSocket.created = 0
  globalThis.WebSocket = FakeWebSocket
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server_error", message: "probe" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  })

  try {
    await failOneWebSocketRequest(sessionId)
    assert.equal(FakeWebSocket.created, 1)
    assert.equal(
      getOpenAICodexWebSocketDebugStats(transportSessionId)?.websocketFallbackActive,
      true,
    )

    manager.reset(sessionId)
    assert.equal(getOpenAICodexWebSocketDebugStats(transportSessionId), undefined)

    await failOneWebSocketRequest(sessionId)
    assert.equal(FakeWebSocket.created, 2)
  } finally {
    manager.dispose()
    closeOpenAICodexWebSocketSessions(transportSessionId)
    resetOpenAICodexWebSocketDebugStats(transportSessionId)
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("agent disposal clears the same public pi-ai session state", async () => {
  const sessionId = "session-agent-dispose-probe"
  const transportSessionId = codexTransportSessionId(sessionId)
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
    assert.equal(
      getOpenAICodexWebSocketDebugStats(transportSessionId)?.websocketFallbackActive,
      true,
    )

    host.listeners.find(({ event }) => event === "agent/disposed")
      .listener({ agent: { id: sessionId } })

    assert.equal(getOpenAICodexWebSocketDebugStats(transportSessionId), undefined)
  } finally {
    for (const dispose of host.effects.toReversed()) dispose?.()
    closeOpenAICodexWebSocketSessions(transportSessionId)
    resetOpenAICodexWebSocketDebugStats(transportSessionId)
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("host /codex reset clears the public pi-ai session state", async () => {
  const sessionId = "session-command-reset-probe"
  const transportSessionId = codexTransportSessionId(sessionId)
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
    assert.equal(
      getOpenAICodexWebSocketDebugStats(transportSessionId)?.websocketFallbackActive,
      true,
    )

    const result = await commands.find(({ name }) => name === "codex")
      .handler({ rawInput: "reset", agent: { id: sessionId } })

    assert.equal(result.kind, "success")
    assert.equal(getOpenAICodexWebSocketDebugStats(transportSessionId), undefined)
  } finally {
    for (const dispose of host.effects.toReversed()) dispose?.()
    closeOpenAICodexWebSocketSessions(transportSessionId)
    resetOpenAICodexWebSocketDebugStats(transportSessionId)
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("host disposal clears all public pi-ai Codex session state", async () => {
  const sessionId = "session-runtime-dispose-probe"
  const transportSessionId = codexTransportSessionId(sessionId)
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
    assert.equal(
      getOpenAICodexWebSocketDebugStats(transportSessionId)?.websocketFallbackActive,
      true,
    )

    for (const dispose of host.effects.toReversed()) dispose?.()
    host.effects.length = 0

    assert.equal(getOpenAICodexWebSocketDebugStats(transportSessionId), undefined)
  } finally {
    for (const dispose of host.effects.toReversed()) dispose?.()
    closeOpenAICodexWebSocketSessions(transportSessionId)
    resetOpenAICodexWebSocketDebugStats(transportSessionId)
    globalThis.fetch = previousFetch
    if (previousWebSocket === undefined) delete globalThis.WebSocket
    else globalThis.WebSocket = previousWebSocket
  }
})

test("plugin disposal leaves an external pi-ai session with the same raw id intact", async () => {
  const sessionId = "session-external-isolation-probe"
  const transportSessionId = codexTransportSessionId(sessionId)
  const previousFetch = globalThis.fetch
  const previousWebSocket = globalThis.WebSocket
  const manager = createCodexSessionResourceManager()
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
    expires: Date.now() + 60_000,
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
