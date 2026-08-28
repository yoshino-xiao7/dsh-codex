import assert from "node:assert/strict"
import test from "node:test"

import { createUserMessage } from "@deepseek-ai/dsh-llm"
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai"

import {
  Config,
  createCodexProfile,
} from "../src/internal/codex-provider-runtime.mjs"
import {
  CODEX_PROVIDER_ID,
  createCodexCredentialStore,
} from "../src/internal/codex-credential-store.mjs"
import { createCodexPiProvider } from "../src/internal/codex-pi-provider.mjs"

test("public PiAiAdapter request auth cannot refresh or revive a grant after delete wins the credential lock", async () => {
  const firstReadStarted = deferred()
  const releaseFirstRead = deferred()
  const recordProvider = serialCredentialProvider(expiredRecord(), {
    pauseFirstRead: { started: firstReadStarted, release: releaseFirstRead },
  })
  let refreshCalls = 0
  let networkCalls = 0
  const { adapter, credentialStore, options } = publicAdapter(recordProvider, {
    async refresh() {
      refreshCalls += 1
      return freshCredential()
    },
  })
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error("the OAuth logout race test must not reach the network")
  }

  try {
    const stream = collect(adapter.stream(options))
    await firstReadStarted.promise

    await credentialStore.delete(CODEX_PROVIDER_ID)
    releaseFirstRead.resolve()

    const chunks = await stream
    assert.equal(refreshCalls, 0)
    assert.equal(networkCalls, 0)
    assert.equal(await credentialStore.read(CODEX_PROVIDER_ID), undefined)
    assert.equal(chunks.at(-1).reason.kind, "error")
  } finally {
    releaseFirstRead.resolve()
    globalThis.fetch = previousFetch
  }
})

test("public PiAiAdapter request refresh cannot outlive the later credential delete", async () => {
  const refreshStarted = deferred()
  const releaseRefresh = deferred()
  const recordProvider = serialCredentialProvider(expiredRecord())
  let refreshCalls = 0
  let networkCalls = 0
  const { adapter, credentialStore, options } = publicAdapter(recordProvider, {
    async refresh() {
      refreshCalls += 1
      refreshStarted.resolve()
      await releaseRefresh.promise
      return freshCredential()
    },
  })
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    networkCalls += 1
    return new Response(JSON.stringify({
      error: { code: "fixture", message: "request intentionally stopped" },
    }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }

  let deleteSettled = false
  let deletion
  try {
    const stream = collect(adapter.stream(options))
    await refreshStarted.promise

    deletion = credentialStore.delete(CODEX_PROVIDER_ID).then(() => {
      deleteSettled = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(deleteSettled, false)

    releaseRefresh.resolve()
    const [chunks] = await Promise.all([stream, deletion])

    assert.equal(refreshCalls, 1)
    assert.equal(networkCalls, 1)
    assert.equal(await credentialStore.read(CODEX_PROVIDER_ID), undefined)
    assert.equal(chunks.at(-1).reason.kind, "error")
  } finally {
    releaseRefresh.resolve()
    await deletion?.catch(() => undefined)
    globalThis.fetch = previousFetch
  }
})

function publicAdapter(recordProvider, oauthOverrides) {
  const source = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: false, transport: "sse" }),
  })
  const provider = Object.freeze({
    ...source,
    auth: Object.freeze({
      oauth: Object.freeze({
        name: "OAuth race fixture",
        login: async () => freshCredential(),
        toAuth: async (credential) => ({ apiKey: credential.access }),
        ...oauthOverrides,
      }),
    }),
  })
  const profile = createCodexProfile(Config({}), provider)
  const credentialStore = createCodexCredentialStore(recordProvider)
  const adapter = new PiAiAdapter({
    profiles: () => new Map([[CODEX_PROVIDER_ID, profile]]),
    resolveApiKey: async () => undefined,
    auth: {
      credentials: credentialStore,
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  const model = provider.getModels().find(({ id }) => id === "gpt-5.4")
    ?? provider.getModels()[0]

  return {
    adapter,
    credentialStore,
    options: {
      provider: CODEX_PROVIDER_ID,
      model: model.id,
      sessionId: "session-oauth-delete-first",
      messages: [createUserMessage({
        content: [{ type: "text", text: "probe" }],
        source: { kind: "user" },
      })],
    },
  }
}

function serialCredentialProvider(initialRecord, options = {}) {
  let record = clone(initialRecord)
  let writes = Promise.resolve()
  let firstRead = true

  const exclusive = (operation) => {
    const result = writes.then(operation)
    writes = result.catch(() => undefined)
    return result
  }

  return {
    async readRecord() {
      const snapshot = clone(record)
      if (firstRead && options.pauseFirstRead !== undefined) {
        firstRead = false
        options.pauseFirstRead.started.resolve()
        await options.pauseFirstRead.release.promise
      }
      return snapshot
    },
    async describeRecord() {
      return record === undefined
        ? { configured: false, writable: true }
        : { configured: true, kind: record.kind, writable: true }
    },
    async modifyRecord(_key, mutate) {
      return exclusive(async () => {
        const next = await mutate(clone(record))
        if (next !== undefined) record = clone(next)
        return clone(record)
      })
    },
    async deleteRecord() {
      await exclusive(async () => {
        record = undefined
      })
    },
  }
}

function expiredRecord() {
  return {
    kind: "grant",
    payload: {
      type: "oauth",
      access: fakeAccessToken(),
      refresh: "expired-refresh-fixture",
      expires: 1,
    },
  }
}

function freshCredential() {
  return {
    type: "oauth",
    access: fakeAccessToken(),
    refresh: "fresh-refresh-fixture",
    expires: Date.now() + 60_000,
  }
}

function fakeAccessToken() {
  const claims = {
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-race-fixture" },
  }
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}
