import assert from "node:assert/strict"
import test from "node:test"

import {
  CODEX_CREDENTIAL_KEY,
  CODEX_PROVIDER_ID,
  createCodexCredentialStore,
} from "../src/internal/codex-credential-store.mjs"
import { registerCodexAuthorizationFlow } from "../src/internal/codex-authorization.mjs"

test("Codex authorization flow relays public OAuth interaction and commits through the owned store", async () => {
  let flow
  let record
  const credentialStore = createCodexCredentialStore({
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    async modifyRecord(_key, mutate) {
      const next = await mutate(record)
      if (next !== undefined) record = next
      return record
    },
    async deleteRecord() {
      record = undefined
    },
  })
  const provider = {
    id: CODEX_PROVIDER_ID,
    name: "Codex fixture",
    auth: {
      oauth: {
        name: "OAuth fixture",
        async login(interaction) {
          interaction.notify({
            type: "device_code",
            userCode: "ABCD-EFGH",
            verificationUri: "https://auth.example.test/device",
            intervalSeconds: 5,
          })
          const method = await interaction.prompt({
            type: "select",
            message: "Choose a method",
            options: [{ id: "device", label: "Device" }],
          })
          assert.equal(method, "device")
          return {
            type: "oauth",
            access: "access-fixture",
            refresh: "refresh-fixture",
            expires: 4_102_444_800_000,
          }
        },
        async refresh(credential) {
          return credential
        },
        async toAuth(credential) {
          return { apiKey: credential.access }
        },
      },
    },
    getModels: () => [],
    stream() {
      throw new Error("not used")
    },
    streamSimple() {
      throw new Error("not used")
    },
  }
  registerCodexAuthorizationFlow({
    authorization: {
      registerFlow(candidate) {
        flow = candidate
        return () => undefined
      },
    },
    credentialStore,
    authContext: {
      env: async () => undefined,
      fileExists: async () => false,
    },
    provider,
  })

  assert.equal(flow.key, CODEX_CREDENTIAL_KEY)
  assert.deepEqual(flow.methods, [{ id: "oauth", label: "使用 ChatGPT 登录 / Sign in with ChatGPT" }])
  const notices = []
  const prompts = []
  await flow.run({
    method: "oauth",
    signal: new AbortController().signal,
    notify: (notice) => notices.push(notice),
    async prompt(prompt) {
      prompts.push(prompt)
      return "device"
    },
  })

  assert.deepEqual(notices, [{
    message: "在浏览器中继续授权。 / Continue authorization in your browser.",
    url: "https://auth.example.test/device",
    code: "ABCD-EFGH",
  }])
  assert.deepEqual(prompts, [{
    kind: "select",
    message: "Choose a method",
    options: [{ id: "device", label: "Device" }],
  }])
  assert.equal(record.kind, "grant")
  assert.equal(record.payload.type, "oauth")
})

test("authorization notices reject unsafe URLs and bound provider-controlled text", async () => {
  let flow
  const provider = {
    id: CODEX_PROVIDER_ID,
    name: "Codex fixture",
    auth: {
      oauth: {
        name: "OAuth fixture",
        async login(interaction) {
          interaction.notify({ type: "auth_url", url: "file:///private/secret", instructions: "x".repeat(10_000) })
          return {
            type: "oauth",
            access: "access-fixture",
            refresh: "refresh-fixture",
            expires: 4_102_444_800_000,
          }
        },
        async refresh(credential) {
          return credential
        },
        async toAuth(credential) {
          return { apiKey: credential.access }
        },
      },
    },
    getModels: () => [],
    stream() {
      throw new Error("not used")
    },
    streamSimple() {
      throw new Error("not used")
    },
  }
  const credentialStore = {
    read: async () => undefined,
    list: async () => [],
    async modify(_provider, mutate) {
      return mutate(undefined)
    },
    delete: async () => undefined,
  }
  registerCodexAuthorizationFlow({
    authorization: { registerFlow(candidate) { flow = candidate } },
    credentialStore,
    authContext: { env: async () => undefined, fileExists: async () => false },
    provider,
  })

  const notices = []
  await flow.run({
    method: "oauth",
    signal: new AbortController().signal,
    notify: (notice) => notices.push(notice),
    prompt: async () => "",
  })
  assert.equal(notices.length, 1)
  assert.equal(notices[0].url, undefined)
  assert.equal(notices[0].message.length, 2_048)
})

test("a cancelled authorization flow cannot commit a late OAuth credential after logout", async () => {
  let flow
  let record
  let modifyCalls = 0
  let releaseLogin
  let markLoginStarted
  const loginStarted = new Promise((resolve) => { markLoginStarted = resolve })
  const lateCredential = {
    type: "oauth",
    access: "late-access-fixture",
    refresh: "late-refresh-fixture",
    expires: 4_102_444_800_000,
  }
  const credentialStore = createCodexCredentialStore({
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    async modifyRecord(_key, mutate) {
      modifyCalls += 1
      const next = await mutate(record)
      if (next !== undefined) record = next
      return record
    },
    async deleteRecord() {
      record = undefined
    },
  })
  const provider = {
    id: CODEX_PROVIDER_ID,
    name: "Codex fixture",
    auth: {
      oauth: {
        name: "OAuth fixture",
        login: async () => {
          markLoginStarted()
          await new Promise((resolve) => { releaseLogin = resolve })
          return lateCredential
        },
        async refresh(credential) {
          return credential
        },
        async toAuth(credential) {
          return { apiKey: credential.access }
        },
      },
    },
    getModels: () => [],
    stream() {
      throw new Error("not used")
    },
    streamSimple() {
      throw new Error("not used")
    },
  }
  registerCodexAuthorizationFlow({
    authorization: {
      registerFlow(candidate) {
        flow = candidate
        return () => undefined
      },
    },
    credentialStore,
    authContext: {
      env: async () => undefined,
      fileExists: async () => false,
    },
    provider,
  })

  const controller = new AbortController()
  const running = flow.run({
    method: "oauth",
    signal: controller.signal,
    notify: () => undefined,
    prompt: async () => "",
  })
  await loginStarted
  controller.abort("signed out")
  await credentialStore.delete(CODEX_PROVIDER_ID)
  releaseLogin()
  await running

  assert.equal(record, undefined)
  assert.equal(modifyCalls, 0)
})

test("the serialized credential write decision is the cancellation linearization point", async () => {
  const previous = {
    kind: "grant",
    payload: {
      type: "oauth",
      access: "previous-access-fixture",
      refresh: "previous-refresh-fixture",
      expires: 4_102_444_700_000,
    },
  }

  for (const initial of [undefined, previous]) {
    const result = await abortAfterCredentialWriteDecision(initial)
    assert.equal(result.queuedBeforeRelease, 1)
    assert.equal(result.record.payload.access, "cancelled-access-fixture")
  }
})

test("a replacement sign-in queued after cancellation remains the final credential", async () => {
  const result = await abortAfterCredentialWriteDecision(undefined, { startReplacement: true })
  assert.equal(result.queuedBeforeRelease, 2)
  assert.equal(result.record.payload.access, "replacement-access-fixture")
})

test("cancelling one process cannot delete another process's already queued sign-in", async () => {
  let firstFlow
  let secondFlow
  let record
  let operationCount = 0
  let deleteCalls = 0
  let releaseFirstPersistence
  let markFirstWriteSelected
  let markSecondWriteQueued
  const firstWriteSelected = new Promise((resolve) => { markFirstWriteSelected = resolve })
  const secondWriteQueued = new Promise((resolve) => { markSecondWriteQueued = resolve })
  const firstPersistenceGate = new Promise((resolve) => { releaseFirstPersistence = resolve })
  let writeQueue = Promise.resolve()
  const enqueueWrite = (operation) => {
    const result = writeQueue.then(operation)
    writeQueue = result.catch(() => undefined)
    return result
  }
  const credentials = {
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    modifyRecord(_key, mutate) {
      operationCount += 1
      const operation = operationCount
      if (operation === 2) markSecondWriteQueued()
      return enqueueWrite(async () => {
        const next = await mutate(record)
        if (operation === 1) {
          markFirstWriteSelected()
          await firstPersistenceGate
        }
        if (next !== undefined) record = next
        return record
      })
    },
    deleteRecord() {
      deleteCalls += 1
      operationCount += 1
      return enqueueWrite(async () => {
        record = undefined
      })
    },
  }
  const register = (credentialStore, credential, capture) => {
    registerCodexAuthorizationFlow({
      authorization: {
        registerFlow(candidate) {
          capture(candidate)
          return () => undefined
        },
      },
      credentialStore,
      authContext: {
        env: async () => undefined,
        fileExists: async () => false,
      },
      provider: {
        id: CODEX_PROVIDER_ID,
        name: "Codex fixture",
        auth: {
          oauth: {
            name: "OAuth fixture",
            login: async () => credential,
            refresh: async (current) => current,
            toAuth: async (current) => ({ apiKey: current.access }),
          },
        },
        getModels: () => [],
        stream() {
          throw new Error("not used")
        },
        streamSimple() {
          throw new Error("not used")
        },
      },
    })
  }
  register(createCodexCredentialStore(credentials), {
    type: "oauth",
    access: "cancelled-process-access-fixture",
    refresh: "cancelled-process-refresh-fixture",
    expires: 4_102_444_800_000,
  }, (flow) => { firstFlow = flow })
  register(createCodexCredentialStore(credentials), {
    type: "oauth",
    access: "replacement-process-access-fixture",
    refresh: "replacement-process-refresh-fixture",
    expires: 4_102_444_800_000,
  }, (flow) => { secondFlow = flow })

  const firstController = new AbortController()
  const first = firstFlow.run({
    method: "oauth",
    signal: firstController.signal,
    notify: () => undefined,
    prompt: async () => "",
  })
  await firstWriteSelected
  const second = secondFlow.run({
    method: "oauth",
    signal: new AbortController().signal,
    notify: () => undefined,
    prompt: async () => "",
  })
  await secondWriteQueued
  firstController.abort("cancelled in another process")
  releaseFirstPersistence()
  await Promise.all([first, second])

  assert.equal(record.payload.access, "replacement-process-access-fixture")
  assert.equal(deleteCalls, 0)
})

async function abortAfterCredentialWriteDecision(initialRecord, options = {}) {
  let flow
  let record = initialRecord
  let loginCount = 0
  let queuedWrites = 0
  let releasePersistence
  let markWriteDecided
  const writeDecided = new Promise((resolve) => { markWriteDecided = resolve })
  const persistenceGate = new Promise((resolve) => { releasePersistence = resolve })
  let writeQueue = Promise.resolve()
  const enqueueWrite = (operation) => {
    const result = writeQueue.then(operation)
    writeQueue = result.catch(() => undefined)
    return result
  }
  const credentialStore = createCodexCredentialStore({
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    modifyRecord(_key, mutate) {
      queuedWrites += 1
      return enqueueWrite(async () => {
        const next = await mutate(record)
        markWriteDecided()
        await persistenceGate
        if (next !== undefined) record = next
        return record
      })
    },
    deleteRecord() {
      queuedWrites += 1
      return enqueueWrite(async () => {
        record = undefined
      })
    },
  })
  const provider = {
    id: CODEX_PROVIDER_ID,
    name: "Codex fixture",
    auth: {
      oauth: {
        name: "OAuth fixture",
        async login() {
          loginCount += 1
          return {
            type: "oauth",
            access: loginCount === 1 ? "cancelled-access-fixture" : "replacement-access-fixture",
            refresh: loginCount === 1 ? "cancelled-refresh-fixture" : "replacement-refresh-fixture",
            expires: 4_102_444_800_000,
          }
        },
        async refresh(credential) {
          return credential
        },
        async toAuth(credential) {
          return { apiKey: credential.access }
        },
      },
    },
    getModels: () => [],
    stream() {
      throw new Error("not used")
    },
    streamSimple() {
      throw new Error("not used")
    },
  }
  registerCodexAuthorizationFlow({
    authorization: {
      registerFlow(candidate) {
        flow = candidate
        return () => undefined
      },
    },
    credentialStore,
    authContext: {
      env: async () => undefined,
      fileExists: async () => false,
    },
    provider,
  })

  const controller = new AbortController()
  const running = flow.run({
    method: "oauth",
    signal: controller.signal,
    notify: () => undefined,
    prompt: async () => "",
  })
  await writeDecided
  controller.abort("cancelled while persistence was pending")
  const replacement = options.startReplacement === true
    ? flow.run({
        method: "oauth",
        signal: new AbortController().signal,
        notify: () => undefined,
        prompt: async () => "",
      })
    : undefined
  if (replacement !== undefined) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const queuedBeforeRelease = queuedWrites
  releasePersistence()
  await running
  if (replacement !== undefined) await replacement
  return { record, queuedBeforeRelease }
}
