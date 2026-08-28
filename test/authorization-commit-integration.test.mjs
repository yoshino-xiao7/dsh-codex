import assert from "node:assert/strict"
import test from "node:test"

import { Context } from "@deepseek-ai/cordis"
import { AuthorizationService } from "@deepseek-ai/dsh-authorization"

import {
  CODEX_AUTHORIZATION_KEY,
  CodexAuthorizationBridge,
} from "../src/internal/authorization-bridge.mjs"
import { createAuthorizationCommitTracker } from "../src/internal/authorization-commit-tracker.mjs"
import { registerCodexAuthorizationFlow } from "../src/internal/codex-authorization.mjs"
import {
  CODEX_PROVIDER_ID,
  createCodexCredentialStore,
} from "../src/internal/codex-credential-store.mjs"

const OAUTH_FIXTURE = Object.freeze({
  type: "oauth",
  access: "integration-access-fixture",
  refresh: "integration-refresh-fixture",
  expires: 4_102_444_800_000,
})

test("the public bridge rejects a too-late cancel and reports the committed sign-in as authorized", async () => {
  const persistence = controlledPersistence()
  const harness = authorizationHarness({
    login: async () => OAUTH_FIXTURE,
    persistence,
  })

  const started = await harness.bridge.start({})
  await persistence.selected
  assert.deepEqual(harness.bridge.cancel({ attemptId: started.attemptId }), {
    accepted: false,
    reason: "commit-in-progress",
  })
  persistence.release()

  const terminal = await waitUntilDone(harness.bridge, started.attemptId)
  assert.deepEqual(terminal.events.at(-1), {
    seq: terminal.events.at(-1).seq,
    type: "settled",
    status: "authorized",
  })
  assert.equal(harness.record()?.payload.access, OAUTH_FIXTURE.access)
  assert.equal(harness.tracker.isCommitPending(), false)
  harness.bridge.dispose()
})

test("precommit cancellation remains cancelled and cannot store a late OAuth result", async () => {
  let markLoginStarted
  const loginStarted = new Promise((resolve) => { markLoginStarted = resolve })
  const harness = authorizationHarness({
    async login({ signal }) {
      markLoginStarted()
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      return OAUTH_FIXTURE
    },
  })

  const started = await harness.bridge.start({})
  await loginStarted
  assert.deepEqual(harness.bridge.cancel({ attemptId: started.attemptId }), { accepted: true })
  const terminal = await waitUntilDone(harness.bridge, started.attemptId)

  assert.equal(terminal.events.at(-1).status, "cancelled")
  assert.equal(harness.record(), undefined)
  assert.equal(harness.tracker.isCommitPending(), false)
  harness.bridge.dispose()
})

test("a persistence failure after commit selection releases the tracker at authorization settlement", async () => {
  const persistence = controlledPersistence({ fail: true })
  const harness = authorizationHarness({
    login: async () => OAUTH_FIXTURE,
    persistence,
  })

  const started = await harness.bridge.start({})
  await persistence.selected
  assert.equal(harness.tracker.isCommitPending(), true)
  persistence.release()
  const terminal = await waitUntilDone(harness.bridge, started.attemptId)

  assert.equal(terminal.events.at(-1).type, "failed")
  assert.equal(harness.record(), undefined)
  assert.equal(harness.tracker.isCommitPending(), false)
  harness.bridge.dispose()
})

test("disposing the bridge after commit selection lets authorization settle as authorized", async () => {
  const persistence = controlledPersistence()
  const harness = authorizationHarness({
    login: async () => OAUTH_FIXTURE,
    persistence,
  })

  await harness.bridge.start({})
  await persistence.selected
  harness.bridge.dispose()
  assert.equal(harness.tracker.isCommitPending(), true)

  persistence.release()
  assert.equal(await harness.settlement, "authorized")
  assert.equal(harness.record()?.payload.access, OAUTH_FIXTURE.access)
  assert.equal(harness.tracker.isCommitPending(), false)
})

test("disposing the bridge before commit selection still cancels authorization", async () => {
  let markLoginStarted
  const loginStarted = new Promise((resolve) => { markLoginStarted = resolve })
  const harness = authorizationHarness({
    async login({ signal }) {
      markLoginStarted()
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      return OAUTH_FIXTURE
    },
  })

  await harness.bridge.start({})
  await loginStarted
  harness.bridge.dispose()

  assert.equal(await harness.settlement, "cancelled")
  assert.equal(harness.record(), undefined)
  assert.equal(harness.tracker.isCommitPending(), false)
})

test("disposing the flow owner waits for a selected credential commit to settle as authorized", async (t) => {
  const persistence = controlledPersistence()
  const root = new Context()
  let record
  let writeQueue = Promise.resolve()
  const credentials = {
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    modifyRecord(key, mutate) {
      const result = writeQueue.then(async () => {
        const next = await mutate(record)
        if (next === undefined) return record
        persistence.markSelected()
        await persistence.wait()
        record = next
        root.emit("credentials/record-updated", key)
        return record
      })
      writeQueue = result.catch(() => undefined)
      return result
    },
    async deleteRecord(key) {
      record = undefined
      root.emit("credentials/record-updated", key)
    },
  }
  root.provide("credentials", credentials)
  new AuthorizationService(root)
  const tracker = createAuthorizationCommitTracker()
  const settlements = []
  root.on("authorization/settled", (key, status) => {
    if (key !== CODEX_AUTHORIZATION_KEY) return
    tracker.settle()
    settlements.push(status)
  }, { global: true })

  const owner = await root.plugin({
    name: "codex-authorization-owner-fixture",
    inject: ["authorization", "credentials"],
    apply(ctx) {
      registerCodexAuthorizationFlow({
        ownerContext: ctx,
        authorization: ctx.authorization,
        credentialStore: createCodexCredentialStore(ctx.credentials),
        authContext: { env: async () => undefined, fileExists: async () => false },
        provider: providerFixture(async () => OAUTH_FIXTURE),
        commitTracker: tracker,
      })
    },
  })
  t.after(async () => {
    persistence.release()
    await root.fiber.dispose()
  })

  const outcomePromise = root.authorization.begin({
    key: CODEX_AUTHORIZATION_KEY,
    interaction: {
      notify() {},
      async prompt() {
        throw new Error("fixture does not prompt")
      },
    },
  })
  await persistence.selected
  let disposalSettled = false
  const disposal = owner.dispose().then(() => { disposalSettled = true })
  await new Promise((resolve) => setImmediate(resolve))

  try {
    assert.equal(disposalSettled, false)
  } finally {
    persistence.release()
  }

  assert.deepEqual(await outcomePromise, { status: "authorized" })
  await disposal
  assert.deepEqual(settlements, ["authorized"])
  assert.equal(record?.payload.access, OAUTH_FIXTURE.access)
  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY), undefined)
})

test("disposing the flow owner waits for a selected credential commit that fails persistence", async (t) => {
  const persistence = controlledPersistence({ fail: true })
  const root = new Context()
  let record
  let writeQueue = Promise.resolve()
  const credentials = {
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    modifyRecord(key, mutate) {
      const result = writeQueue.then(async () => {
        const next = await mutate(record)
        if (next === undefined) return record
        persistence.markSelected()
        await persistence.wait()
        if (persistence.fail) throw new Error("credential persistence fixture failed")
        record = next
        root.emit("credentials/record-updated", key)
        return record
      })
      writeQueue = result.catch(() => undefined)
      return result
    },
    async deleteRecord(key) {
      record = undefined
      root.emit("credentials/record-updated", key)
    },
  }
  root.provide("credentials", credentials)
  new AuthorizationService(root)
  const tracker = createAuthorizationCommitTracker()
  const settlements = []
  root.on("authorization/settled", (key, status) => {
    if (key !== CODEX_AUTHORIZATION_KEY) return
    tracker.settle()
    settlements.push(status)
  }, { global: true })

  const owner = await root.plugin({
    name: "codex-authorization-failed-commit-owner-fixture",
    inject: ["authorization", "credentials"],
    apply(ctx) {
      registerCodexAuthorizationFlow({
        ownerContext: ctx,
        authorization: ctx.authorization,
        credentialStore: createCodexCredentialStore(ctx.credentials),
        authContext: { env: async () => undefined, fileExists: async () => false },
        provider: providerFixture(async () => OAUTH_FIXTURE),
        commitTracker: tracker,
      })
    },
  })
  t.after(async () => {
    persistence.release()
    await root.fiber.dispose()
  })

  const outcomePromise = root.authorization.begin({
    key: CODEX_AUTHORIZATION_KEY,
    interaction: {
      notify() {},
      async prompt() {
        throw new Error("fixture does not prompt")
      },
    },
  })
  const observedOutcome = outcomePromise.then(
    (value) => ({ kind: "resolved", value }),
    (error) => ({ kind: "rejected", error }),
  )
  await persistence.selected
  let disposalSettled = false
  const disposal = owner.dispose().then(() => { disposalSettled = true })
  await new Promise((resolve) => setImmediate(resolve))

  try {
    assert.equal(disposalSettled, false)
  } finally {
    persistence.release()
  }

  const outcome = await observedOutcome
  assert.equal(outcome.kind, "rejected")
  assert.equal(outcome.error?.message, "credential persistence fixture failed")
  await disposal
  assert.deepEqual(settlements, ["failed"])
  assert.equal(record, undefined)
  assert.equal(tracker.isCommitPending(), false)
  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY), undefined)
})

test("disposing the flow owner cancels an authorization attempt before commit selection", async (t) => {
  const root = new Context()
  let record
  let markLoginStarted
  const loginStarted = new Promise((resolve) => { markLoginStarted = resolve })
  const credentials = {
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(record)
      if (next !== undefined) {
        record = next
        root.emit("credentials/record-updated", key)
      }
      return record
    },
    async deleteRecord(key) {
      record = undefined
      root.emit("credentials/record-updated", key)
    },
  }
  root.provide("credentials", credentials)
  new AuthorizationService(root)
  const tracker = createAuthorizationCommitTracker()
  const settlements = []
  root.on("authorization/settled", (key, status) => {
    if (key === CODEX_AUTHORIZATION_KEY) settlements.push(status)
  }, { global: true })
  const owner = await root.plugin({
    name: "codex-authorization-precommit-owner-fixture",
    inject: ["authorization", "credentials"],
    apply(ctx) {
      registerCodexAuthorizationFlow({
        ownerContext: ctx,
        authorization: ctx.authorization,
        credentialStore: createCodexCredentialStore(ctx.credentials),
        authContext: { env: async () => undefined, fileExists: async () => false },
        provider: providerFixture(async ({ signal }) => {
          markLoginStarted()
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
          return OAUTH_FIXTURE
        }),
        commitTracker: tracker,
      })
    },
  })
  t.after(async () => root.fiber.dispose())

  const outcome = root.authorization.begin({
    key: CODEX_AUTHORIZATION_KEY,
    interaction: {
      notify() {},
      async prompt() {
        throw new Error("fixture does not prompt")
      },
    },
  })
  await loginStarted
  await owner.dispose()

  assert.deepEqual(await outcome, { status: "cancelled" })
  assert.deepEqual(settlements, ["cancelled"])
  assert.equal(record, undefined)
  assert.equal(tracker.isCommitPending(), false)
  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY), undefined)
})

test("disposing an idle flow owner completes immediately and removes the flow", async (t) => {
  const root = new Context()
  const credentials = {
    async readRecord() {
      return undefined
    },
    async describeRecord() {
      return { configured: false, writable: true }
    },
    async modifyRecord() {
      throw new Error("idle owner must not write credentials")
    },
    async deleteRecord() {
      throw new Error("idle owner must not delete credentials")
    },
  }
  root.provide("credentials", credentials)
  new AuthorizationService(root)
  const tracker = createAuthorizationCommitTracker()
  const settlements = []
  root.on("authorization/settled", (key, status) => {
    if (key === CODEX_AUTHORIZATION_KEY) settlements.push(status)
  }, { global: true })
  const owner = await root.plugin({
    name: "codex-authorization-idle-owner-fixture",
    inject: ["authorization", "credentials"],
    apply(ctx) {
      registerCodexAuthorizationFlow({
        ownerContext: ctx,
        authorization: ctx.authorization,
        credentialStore: createCodexCredentialStore(ctx.credentials),
        authContext: { env: async () => undefined, fileExists: async () => false },
        provider: providerFixture(async () => OAUTH_FIXTURE),
        commitTracker: tracker,
      })
    },
  })
  t.after(async () => root.fiber.dispose())

  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY)?.inFlight, false)
  const result = await Promise.race([
    owner.dispose().then(() => "disposed"),
    new Promise((resolve) => setImmediate(() => resolve("still-pending"))),
  ])

  assert.equal(result, "disposed")
  assert.deepEqual(settlements, [])
  assert.equal(tracker.isCommitPending(), false)
  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY), undefined)
})

test("a new flow owner can register after the previous owner has unloaded", async (t) => {
  const root = new Context()
  let record
  const credentials = {
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: record !== undefined, kind: record?.kind, writable: true }
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(record)
      if (next !== undefined) {
        record = next
        root.emit("credentials/record-updated", key)
      }
      return record
    },
    async deleteRecord(key) {
      record = undefined
      root.emit("credentials/record-updated", key)
    },
  }
  root.provide("credentials", credentials)
  new AuthorizationService(root)
  const registerOwner = (name) => root.plugin({
    name,
    inject: ["authorization", "credentials"],
    apply(ctx) {
      registerCodexAuthorizationFlow({
        ownerContext: ctx,
        authorization: ctx.authorization,
        credentialStore: createCodexCredentialStore(ctx.credentials),
        authContext: { env: async () => undefined, fileExists: async () => false },
        provider: providerFixture(async () => OAUTH_FIXTURE),
        commitTracker: createAuthorizationCommitTracker(),
      })
    },
  })
  t.after(async () => root.fiber.dispose())

  const previousOwner = await registerOwner("codex-authorization-previous-owner-fixture")
  await previousOwner.dispose()
  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY), undefined)

  const currentOwner = await registerOwner("codex-authorization-current-owner-fixture")
  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY)?.inFlight, false)
  const outcome = await root.authorization.begin({
    key: CODEX_AUTHORIZATION_KEY,
    interaction: {
      notify() {},
      async prompt() {
        throw new Error("fixture does not prompt")
      },
    },
  })

  assert.deepEqual(outcome, { status: "authorized" })
  assert.equal(record?.payload.access, OAUTH_FIXTURE.access)
  await currentOwner.dispose()
  assert.equal(root.authorization.describe(CODEX_AUTHORIZATION_KEY), undefined)
})

test("logout bypasses the commit barrier and remains the final serialized credential state", async () => {
  const persistence = controlledPersistence()
  const harness = authorizationHarness({
    login: async () => OAUTH_FIXTURE,
    persistence,
  })

  const started = await harness.bridge.start({})
  await persistence.selected
  const logout = harness.bridge.logout({})
  persistence.release()
  assert.deepEqual(await logout, { signedOut: true })
  const terminal = await waitUntilDone(harness.bridge, started.attemptId)

  assert.equal(terminal.events.at(-1).status, "cancelled")
  assert.equal(harness.record(), undefined)
  assert.equal(harness.tracker.isCommitPending(), false)
  harness.bridge.dispose()
})

function authorizationHarness({ login, persistence = controlledPersistence({ blocked: false }) }) {
  const ctx = new Context()
  let record
  let markSettlement
  const settlement = new Promise((resolve) => { markSettlement = resolve })
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
    modifyRecord(key, mutate) {
      return enqueueWrite(async () => {
        const next = await mutate(record)
        if (next === undefined) return record
        persistence.markSelected()
        await persistence.wait()
        if (persistence.fail) throw new Error("credential persistence fixture failed")
        record = next
        ctx.emit("credentials/record-updated", key)
        return record
      })
    },
    deleteRecord(key) {
      return enqueueWrite(async () => {
        record = undefined
        ctx.emit("credentials/record-updated", key)
      })
    },
  }
  ctx.provide("credentials", credentials)
  new AuthorizationService(ctx)

  const tracker = createAuthorizationCommitTracker()
  ctx.on("authorization/settled", (key, status) => {
    if (key === CODEX_AUTHORIZATION_KEY) {
      tracker.settle()
      markSettlement(status)
    }
  }, { global: true })
  registerCodexAuthorizationFlow({
    authorization: ctx.authorization,
    credentialStore: createCodexCredentialStore(credentials),
    authContext: { env: async () => undefined, fileExists: async () => false },
    provider: providerFixture(login),
    commitTracker: tracker,
  })

  return {
    bridge: new CodexAuthorizationBridge({
      authorization: ctx.authorization,
      credentials,
    }, { commitTracker: tracker, waitMs: 50 }),
    record: () => record,
    settlement,
    tracker,
  }
}

function controlledPersistence(options = {}) {
  let release
  let markSelected
  const selected = new Promise((resolve) => { markSelected = resolve })
  const gate = options.blocked === false
    ? Promise.resolve()
    : new Promise((resolve) => { release = resolve })
  return {
    fail: options.fail === true,
    selected,
    markSelected,
    release: release ?? (() => undefined),
    wait: () => gate,
  }
}

function providerFixture(login) {
  return {
    id: CODEX_PROVIDER_ID,
    name: "Codex integration fixture",
    auth: {
      oauth: {
        name: "OAuth fixture",
        login,
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
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
}

async function waitUntilDone(bridge, attemptId) {
  const events = []
  let nextSeq = 0
  while (true) {
    const page = await bridge.status({ attemptId, after: nextSeq })
    events.push(...page.events)
    nextSeq = page.nextSeq
    if (page.done) return { ...page, events }
  }
}
