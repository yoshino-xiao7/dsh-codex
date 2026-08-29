import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import test from "node:test"

import {
  CODEX_SETTINGS_NAMESPACE,
  Config,
  installCodexProviderRuntime,
} from "../src/internal/codex-provider-runtime.mjs"
import { createCodexPiProvider } from "../src/internal/codex-pi-provider.mjs"
import { CODEX_ROUTE_ID } from "../src/internal/codex-route-adapter.mjs"

const root = new URL("../", import.meta.url)
const plain = (value) => JSON.parse(JSON.stringify(value))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function hookHarness() {
  const hooks = []
  let component
  let props
  let hookIndex = 0
  let tree
  let dirty = false
  let pendingEffects = []
  let unmounted = false
  let updatesAfterUnmount = 0

  const sameDependencies = (left, right) => left !== undefined
    && right !== undefined
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))

  const React = {
    Fragment: Symbol("Fragment"),
    createElement: (type, elementProps, ...children) => ({
      type,
      props: elementProps ?? {},
      children,
    }),
    useState(initial) {
      const index = hookIndex++
      if (hooks[index] === undefined) {
        hooks[index] = { kind: "state", value: typeof initial === "function" ? initial() : initial }
      }
      const setValue = (next) => {
        if (unmounted) updatesAfterUnmount += 1
        const current = hooks[index].value
        hooks[index].value = typeof next === "function" ? next(current) : next
        dirty = true
      }
      return [hooks[index].value, setValue]
    },
    useRef(initial) {
      const index = hookIndex++
      if (hooks[index] === undefined) hooks[index] = { kind: "ref", value: { current: initial } }
      return hooks[index].value
    },
    useCallback(callback, dependencies) {
      const index = hookIndex++
      const previous = hooks[index]
      if (previous === undefined || !sameDependencies(previous.dependencies, dependencies)) {
        hooks[index] = { kind: "callback", value: callback, dependencies }
      }
      return hooks[index].value
    },
    useEffect(effect, dependencies) {
      const index = hookIndex++
      const previous = hooks[index]
      if (previous === undefined || !sameDependencies(previous.dependencies, dependencies)) {
        pendingEffects.push({ index, effect, dependencies })
      }
    },
  }

  function render() {
    hookIndex = 0
    pendingEffects = []
    dirty = false
    tree = component(props)
    for (const pending of pendingEffects) {
      hooks[pending.index]?.cleanup?.()
      hooks[pending.index] = {
        kind: "effect",
        dependencies: pending.dependencies,
        cleanup: pending.effect(),
      }
    }
    return tree
  }

  return {
    React,
    mount(nextComponent, nextProps) {
      unmounted = false
      component = nextComponent
      props = nextProps
      return render()
    },
    flush() {
      return dirty ? render() : tree
    },
    tree: () => tree,
    unmount() {
      unmounted = true
      for (const hook of hooks) hook?.cleanup?.()
    },
    updatesAfterUnmount: () => updatesAfterUnmount,
  }
}

function textContent(value) {
  if (value === null || value === undefined || value === false) return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(textContent).join("")
  return textContent(value.children)
}

function findElement(value, predicate) {
  if (value === null || value === undefined || value === false) return undefined
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findElement(child, predicate)
      if (match !== undefined) return match
    }
    return undefined
  }
  if (typeof value !== "object") return undefined
  if (predicate(value)) return value
  return findElement(value.children, predicate)
}

function findElements(value, predicate, matches = []) {
  if (value === null || value === undefined || value === false) return matches
  if (Array.isArray(value)) {
    for (const child of value) findElements(child, predicate, matches)
    return matches
  }
  if (typeof value !== "object") return matches
  if (predicate(value)) matches.push(value)
  findElements(value.children, predicate, matches)
  return matches
}

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
}

async function loadClientModule(React, windowOverrides = {}, options = {}) {
  const source = options.source
    ?? await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  const window = {
    setInterval: () => 1,
    clearInterval: () => undefined,
    ...windowOverrides,
    __ModuleLoader__: { load: (spec) => { registration = spec } },
  }
  const globals = { AbortController, window }
  if (options.document !== undefined) globals.document = options.document
  vm.runInNewContext(source, globals)
  return registration.factory((specifier) => {
    assert.equal(specifier, "react")
    return React
  })
}

function styleDocumentHarness() {
  const styles = []
  const head = {
    appendChild(style) {
      styles.push(style)
      style.parentNode = head
      return style
    },
    removeChild(style) {
      const index = styles.indexOf(style)
      if (index !== -1) styles.splice(index, 1)
      style.parentNode = null
      return style
    },
  }
  const document = {
    querySelector: () => styles.find((style) => style.dataset.pluginCss !== undefined) ?? null,
    createElement(tag) {
      assert.equal(tag, "style")
      const style = {
        dataset: {},
        parentNode: null,
        textContent: "",
        remove() {
          style.parentNode?.removeChild(style)
        },
      }
      return style
    },
    head,
  }
  return { document, styles }
}

function applyClientModule(clientModule) {
  const cleanups = []
  const context = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    settingsScope: {
      describe: () => settingsMirror({ writable: true, namespaces: [] }),
    },
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === "function") cleanups.push(cleanup)
    },
    locale: {
      register: () => () => undefined,
      bind: () => (key) => key,
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: () => () => undefined,
    },
  }
  clientModule.apply(context)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const cleanup of cleanups.reverse()) cleanup()
  }
}

function registeredClientDictionaries(clientModule) {
  let dictionaries
  clientModule.apply({
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    settingsScope: { describe: () => undefined },
    effect(callback) {
      callback()
    },
    locale: {
      register(namespace, value) {
        assert.equal(namespace, "settings.codex")
        dictionaries = value
        return () => undefined
      },
      bind: () => (key) => key,
    },
    slots: {
      inject(_name, callback) {
        callback()
      },
      register: () => () => undefined,
    },
  })
  assert.ok(dictionaries)
  return dictionaries
}

function settingsMirror(view, hooks = {}) {
  let snapshot = { status: "ready", view }
  const listeners = new Set()
  return {
    async ensure() {
      hooks.onEnsure?.()
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    acceptView(namespace) {
      hooks.onAccept?.(namespace)
      if (typeof namespace?.ns === "string") {
        snapshot = {
          status: "ready",
          view: {
            ...snapshot.view,
            namespaces: snapshot.view.namespaces.map((entry) => entry.ns === namespace.ns ? namespace : entry),
          },
        }
      }
      for (const listener of listeners) listener()
    },
  }
}

function modelSettingsRuntimeHarness() {
  const provider = createCodexPiProvider()
  let resolved = Config({})
  let user = {}
  let revision = 1
  let validate
  let publish
  const adapters = []
  const discoveries = []
  const mutations = []
  const settingsContext = {
    settings: {
      register(namespace, schema, options) {
        assert.equal(namespace, CODEX_SETTINGS_NAMESPACE)
        assert.equal(schema, Config)
        validate = options.validate
        return {
          get: () => resolved,
          watch(callback) {
            publish = callback
            return () => undefined
          },
        }
      },
    },
    effect(callback) {
      callback()
      return () => undefined
    },
  }
  const ctx = {
    fiber: { state: 0 },
    credentials: {
      readRecord: async () => undefined,
      describeRecord: async () => ({ configured: false, writable: true }),
      modifyRecord: async (_key, mutate) => mutate(undefined),
      deleteRecord: async () => undefined,
    },
    authorization: {
      registerFlow: () => () => undefined,
    },
    llm: {
      registerAdapter(routes, adapter) {
        assert.deepEqual([...routes], [CODEX_ROUTE_ID])
        adapters.push(adapter)
        const dispose = () => undefined
        dispose.replace = () => undefined
        return dispose
      },
      registerConfigurableProviders() {
        const dispose = () => undefined
        dispose.replace = () => undefined
        return dispose
      },
      registerModelDiscovery(namespace, discover) {
        discoveries.push({ namespace, discover })
        return () => undefined
      },
    },
    logger: { warn() {} },
    get: () => undefined,
    inject(services, callback) {
      if (services.length === 1 && services[0] === "settings") callback(settingsContext)
    },
  }
  const runtime = installCodexProviderRuntime(ctx, resolved, {
    provider,
    sessionPreferences: { resolve: () => ({ fast: false, transport: "auto" }) },
  })
  const namespaceView = () => ({
    ns: CODEX_SETTINGS_NAMESPACE,
    schema: {},
    value: resolved,
    user,
    applies: "live",
    secrets: [],
    revision,
  })
  const mirror = settingsMirror({
    writable: true,
    hasDocument: true,
    namespaces: [namespaceView()],
  })
  const ok = (value) => ({ result: { ok: true, value } })
  const connection = {
    api: {
      llm: {
        async discoverModels(payload, signal) {
          const discovery = discoveries.find(({ namespace }) => namespace === payload.settingsNs)
          assert.ok(discovery, `missing model discovery for ${payload.settingsNs}`)
          return ok({ models: await discovery.discover({ provider: payload.provider, signal }) })
        },
      },
      settings: {
        async mutate(payload, signal) {
          mutations.push({ payload, signal })
          assert.equal(payload.ns, CODEX_SETTINGS_NAMESPACE)
          assert.equal(payload.expectedRevision, revision)
          for (const op of payload.ops) {
            assert.deepEqual([...op.path], ["models"])
            if (op.op === "set") user = { ...user, models: plain(op.value) }
            else if (op.op === "unset") {
              const { models: _models, ...rest } = user
              user = rest
            } else {
              assert.fail(`unsupported settings mutation ${op.op}`)
            }
          }
          const previous = resolved
          const next = Config(user)
          validate(next)
          resolved = next
          await publish(next, previous)
          revision += 1
          return ok(namespaceView())
        },
      },
    },
  }

  return {
    adapter: adapters[0],
    connection,
    mirror,
    mutations,
    namespaceView,
    provider,
    runtime,
  }
}

test("classic web bundle registers the package id and Codex settings section", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(spec) {
          registration = spec
        },
      },
    },
  }, { filename: "src/client/index.js" })

  assert.equal(registration.id, "dsh-codex-community")
  const clientModule = registration.factory((specifier) => {
    assert.equal(specifier, "react")
    return { createElement: () => undefined }
  })
  assert.deepEqual([...clientModule.inject], ["slots", "locale", "connection", "settingsScope"])
  assert.equal(clientModule.CHANNEL, "/dsh-codex")
  assert.equal(clientModule.NS, "settings.codex")

  const dictionaries = []
  const sections = []
  const injectedSlots = []
  const context = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    settingsScope: {
      describe: () => settingsMirror({ writable: true, namespaces: [] }),
    },
    effect(callback) {
      callback()
    },
    locale: {
      register(namespace, value) {
        dictionaries.push({ namespace, value })
        return () => undefined
      },
      bind: () => (key) => key,
    },
    slots: {
      inject(name, callback) {
        injectedSlots.push(name)
        callback()
      },
      register(spec, component) {
        sections.push({ spec, component })
        return () => undefined
      },
    },
  }
  clientModule.apply(context)

  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0].namespace, "settings.codex")
  assert.equal(dictionaries[0].value.zh.title, "Codex 登录")
  assert.equal(dictionaries[0].value.en.title, "Codex sign-in")
  assert.deepEqual(
    Object.keys(dictionaries[0].value.zh).sort(),
    Object.keys(dictionaries[0].value.en).sort(),
  )
  assert.deepEqual(injectedSlots, ["settings.section"])
  assert.equal(sections.length, 1)
  assert.equal(sections[0].spec.name, "settings.section")
  assert.equal(sections[0].spec.id, "codex")
  assert.equal(sections[0].spec.order, 15)
  assert.equal(sections[0].spec.label(), "nav")
  assert.equal(typeof sections[0].component, "function")
  assert.equal(sections[0].spec.inject().modelClient.available, false)
  assert.match(dictionaries[0].value.zh.modelsDescription, /模型选择器.*旧会话.*精确模型失效/)
  assert.match(dictionaries[0].value.en.modelsDescription, /model selector.*does not invalidate.*older session/)
  assert.match(dictionaries[0].value.zh.modelsAllEnabledFollow, /清除覆盖.*未来新增/)
  assert.match(dictionaries[0].value.zh.modelsAllEnabledPreserve, /保留现有模型参数.*不会自动启用/)
  assert.match(dictionaries[0].value.en.modelsAllEnabledFollow, /clear it.*future catalog additions/)
  assert.match(dictionaries[0].value.en.modelsAllEnabledPreserve, /preserve existing model parameters.*will not be enabled automatically/)
})

test("settings section selection reaches the public settings API and live route directory", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const runtimeHarness = modelSettingsRuntimeHarness()
  let section
  const context = {
    connection: runtimeHarness.connection,
    settingsScope: { describe: () => runtimeHarness.mirror },
    effect(callback) {
      callback()
    },
    locale: {
      register: () => () => undefined,
      bind: () => (key) => key,
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, "settings.section")
        callback()
      },
      register(spec, component) {
        section = { spec, component }
        return () => undefined
      },
    },
  }
  clientModule.apply(context)
  assert.ok(section)

  harness.mount(section.component, section.spec.inject())
  const modelSettings = findElement(
    harness.tree(),
    (element) => element.type === clientModule.ModelEnablementSettings,
  )
  assert.ok(modelSettings, "registered settings.section must render model settings")
  harness.mount(modelSettings.type, modelSettings.props)
  await settle()
  harness.flush()
  const checkboxes = findElements(
    harness.tree(),
    (element) => element.type === "input" && element.props.type === "checkbox",
  )
  assert.equal(checkboxes.length, runtimeHarness.provider.getModels().length)

  const removed = runtimeHarness.provider.getModels()[0]
  checkboxes[0].props.onChange()
  harness.flush()
  const save = findElement(
    harness.tree(),
    (element) => element.type === "button" && textContent(element) === "modelsSave",
  )
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  await settle()
  harness.flush()

  assert.equal(runtimeHarness.mutations.length, 1)
  const mutation = runtimeHarness.mutations[0].payload
  assert.equal(mutation.ns, "dsh-codex")
  assert.equal(mutation.expectedRevision, 1)
  assert.equal(mutation.ops[0].op, "set")
  assert.deepEqual([...mutation.ops[0].path], ["models"])
  const selectedIds = runtimeHarness.provider.getModels().slice(1).map(({ id }) => id)
  assert.deepEqual(plain(mutation.ops[0].value).map(({ id }) => id), selectedIds)
  assert.deepEqual(plain(runtimeHarness.namespaceView().user.models).map(({ id }) => id), selectedIds)
  assert.deepEqual(runtimeHarness.runtime.getConfig().models.map(({ id }) => id), selectedIds)
  assert.deepEqual(
    (await runtimeHarness.adapter.listModels(CODEX_ROUTE_ID)).map(({ id }) => id),
    selectedIds,
  )
  assert.equal(selectedIds.includes(removed.id), false)
  harness.unmount()
})

test("browser client calls only the loopback authorization RPC contract", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const calls = []
  const connection = {
    rpc: {
      async call(channel, endpoint, payload, signal) {
        calls.push({ channel, endpoint, payload, signal })
        return { ok: true, value: { endpoint } }
      },
    },
  }
  const client = clientModule.createAuthorizationClient(connection)
  const signal = new AbortController().signal

  await client.describe(signal)
  await client.watch("attempt", 4, signal)
  await client.start("oauth")
  await client.answer("attempt", "prompt", "short-lived-answer")
  await client.decline("attempt", "prompt")
  await client.cancel("attempt")
  await client.logout()

  assert.ok(calls.every((call) => call.channel === "/dsh-codex"))
  assert.deepEqual(calls.map((call) => call.endpoint), [
    "status",
    "status",
    "start",
    "respond",
    "respond",
    "cancel",
    "logout",
  ])
  assert.equal(Object.keys(calls.at(-1).payload).length, 0)
})

function authorizationStatus(
  configured,
  inFlight = false,
  state = configured ? "signed-in" : "signed-out",
) {
  return {
    flow: {
      key: "dsh-codex/openai-codex",
      label: "Codex",
      methods: [{ id: "oauth", label: "OAuth" }],
      inFlight,
    },
    credential: { configured, state, writable: true },
    quota: { status: "unknown" },
  }
}

async function renderQuotaView(quota, language) {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  const client = {
    describe: async () => ({ ...authorizationStatus(false), quota }),
  }

  harness.mount(clientModule.AuthorizationSettings, {
    client,
    t: (key) => dictionaries[language][key] ?? key,
  })
  await settle()
  harness.flush()
  const text = textContent(harness.tree())
  harness.unmount()
  return { dictionaries, text }
}

test("authorization settings distinguish an invalid stored credential from a signed-in session", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const client = {
    describe: async () => authorizationStatus(true, false, "invalid"),
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()

  const text = textContent(harness.tree())
  assert.match(text, /credentialInvalid/u)
  assert.match(text, /credentialInvalidHelp/u)
  assert.doesNotMatch(text, /signedIn/u)
  assert.ok(findElement(
    harness.tree(),
    (element) => element.type === "button" && textContent(element) === "signInAgain",
  ))
  assert.ok(findElement(
    harness.tree(),
    (element) => element.type === "button" && textContent(element) === "signOut",
  ))
  harness.unmount()
})

test("external authorization cancellation is mutually exclusive and refreshes immediately", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const cancelled = deferred()
  let describeCalls = 0
  const client = {
    describe: async () => {
      describeCalls += 1
      return authorizationStatus(false, describeCalls === 1)
    },
    cancel: async () => {
      await cancelled.promise
      return { accepted: true }
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  const cancel = findElement(harness.tree(), (element) => element.type === "button" && textContent(element) === "cancel")
  assert.ok(cancel)
  cancel.props.onClick()
  harness.flush()
  const pendingCancel = findElement(harness.tree(), (element) => element.type === "button" && textContent(element) === "cancel")
  assert.equal(pendingCancel.props.disabled, true)

  cancelled.resolve()
  await settle()
  harness.flush()
  assert.equal(describeCalls, 2)
  assert.match(textContent(harness.tree()), /signedOut/u)
  assert.doesNotMatch(textContent(harness.tree()), /inProgress/u)
  harness.unmount()
})

test("a too-late cancellation keeps the authorization watcher alive until commit settles", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const terminal = deferred()
  let describeCalls = 0
  const client = {
    describe: async () => {
      describeCalls += 1
      return authorizationStatus(false, describeCalls > 1)
    },
    start: async () => ({ attemptId: "commit-attempt" }),
    watch: async () => terminal.promise,
    cancel: async () => ({ accepted: false, reason: "commit-in-progress" }),
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  findElement(harness.tree(), (element) => element.type === "button" && /signIn/u.test(textContent(element))).props.onClick()
  await settle()
  harness.flush()
  findElement(harness.tree(), (element) => element.type === "button" && textContent(element) === "cancel").props.onClick()
  await settle()
  harness.flush()
  assert.match(textContent(harness.tree()), /commitInProgress/u)

  terminal.resolve({
    events: [{ seq: 1, type: "settled", status: "authorized" }],
    nextSeq: 1,
    done: true,
  })
  await settle()
  harness.flush()
  assert.match(textContent(harness.tree()), /authorized/u)
  assert.doesNotMatch(textContent(harness.tree()), /commitInProgress|cancelled/u)
  harness.unmount()
})

test("a late cancel reply cannot overwrite an authorization terminal event", async () => {
  for (const mode of ["too-late", "failed"]) {
    const harness = hookHarness()
    const clientModule = await loadClientModule(harness.React)
    const terminal = deferred()
    const cancelReply = deferred()
    const client = {
      describe: async () => authorizationStatus(false),
      start: async () => ({ attemptId: `terminal-before-cancel-${mode}` }),
      watch: async () => terminal.promise,
      cancel: async () => cancelReply.promise,
    }

    harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
    await settle()
    harness.flush()
    findElement(harness.tree(), (element) => element.type === "button" && /signIn/u.test(textContent(element))).props.onClick()
    await settle()
    harness.flush()
    findElement(harness.tree(), (element) => element.type === "button" && textContent(element) === "cancel").props.onClick()
    terminal.resolve({
      events: [{ seq: 1, type: "settled", status: "authorized" }],
      nextSeq: 1,
      done: true,
    })
    await settle()
    harness.flush()
    if (mode === "failed") cancelReply.reject(new Error("late cancellation failure"))
    else cancelReply.resolve({ accepted: false, reason: "commit-in-progress" })
    await settle()
    harness.flush()

    assert.match(textContent(harness.tree()), /authorized/u)
    assert.doesNotMatch(textContent(harness.tree()), /commitInProgress|cancelFailed|cancelled/u)
    harness.unmount()
  }
})

test("logout locks conflicting actions and cannot start a new authorization attempt", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React, { confirm: () => true })
  const loggedOut = deferred()
  let describeCalls = 0
  let startCalls = 0
  const client = {
    describe: async () => {
      describeCalls += 1
      return authorizationStatus(describeCalls === 1)
    },
    logout: async () => loggedOut.promise,
    start: async () => {
      startCalls += 1
      return { attemptId: "must-not-start" }
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  const signOut = findElement(harness.tree(), (element) => element.type === "button" && textContent(element) === "signOut")
  assert.ok(signOut)
  signOut.props.onClick()
  harness.flush()

  assert.match(textContent(harness.tree()), /signingOut/u)
  const buttons = findElements(harness.tree(), (element) => element.type === "button")
  const signInAgain = buttons.find((button) => textContent(button) === "signInAgain")
  const pendingSignOut = buttons.find((button) => textContent(button) === "signingOut")
  assert.equal(signInAgain.props.disabled, true)
  assert.equal(pendingSignOut.props.disabled, true)
  signInAgain.props.onClick()
  await settle()
  assert.equal(startCalls, 0)

  loggedOut.resolve({ signedOut: true })
  await settle()
  harness.flush()
  assert.equal(describeCalls, 2)
  assert.match(textContent(harness.tree()), /signedOut/u)
  assert.doesNotMatch(textContent(harness.tree()), /signingOut/u)
  harness.unmount()
})

test("cancel and logout failures use action-specific localized messages", async () => {
  const cancelHarness = hookHarness()
  const cancelModule = await loadClientModule(cancelHarness.React)
  cancelHarness.mount(cancelModule.AuthorizationSettings, {
    client: {
      describe: async () => authorizationStatus(false, true),
      cancel: async () => { throw new Error("cancel failed") },
    },
    t: (key) => key,
  })
  await settle()
  cancelHarness.flush()
  findElement(cancelHarness.tree(), (element) => element.type === "button" && textContent(element) === "cancel").props.onClick()
  await settle()
  cancelHarness.flush()
  assert.match(textContent(cancelHarness.tree()), /cancelFailed/u)
  cancelHarness.unmount()

  const logoutHarness = hookHarness()
  const logoutModule = await loadClientModule(logoutHarness.React, { confirm: () => true })
  logoutHarness.mount(logoutModule.AuthorizationSettings, {
    client: {
      describe: async () => authorizationStatus(true),
      logout: async () => { throw new Error("logout failed") },
    },
    t: (key) => key,
  })
  await settle()
  logoutHarness.flush()
  findElement(logoutHarness.tree(), (element) => element.type === "button" && textContent(element) === "signOut").props.onClick()
  await settle()
  logoutHarness.flush()
  assert.match(textContent(logoutHarness.tree()), /logoutFailed/u)
  logoutHarness.unmount()
})

test("a prompt response can recover without retaining a stale failure", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const terminal = deferred()
  let watchCalls = 0
  let answerCalls = 0
  let describeCalls = 0
  const client = {
    describe: async () => {
      describeCalls += 1
      return authorizationStatus(describeCalls > 1)
    },
    start: async () => ({ attemptId: "prompt-attempt" }),
    watch: async () => {
      watchCalls += 1
      if (watchCalls === 1) {
        return {
          events: [{
            seq: 1,
            type: "prompt",
            promptId: "prompt-1",
            prompt: { kind: "text", message: "Answer", placeholder: "value" },
          }],
          nextSeq: 1,
          done: false,
        }
      }
      return terminal.promise
    },
    answer: async () => {
      answerCalls += 1
      if (answerCalls === 1) throw new Error("temporary response failure")
      return { accepted: true }
    },
    decline: async () => ({ accepted: true }),
    cancel: async () => ({ accepted: true }),
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  findElement(harness.tree(), (element) => element.type === "button" && /signIn/u.test(textContent(element))).props.onClick()
  await settle()
  harness.flush()
  let form = findElement(harness.tree(), (element) => element.type === "form")
  form.props.onSubmit({ preventDefault() {} })
  await settle()
  harness.flush()
  assert.match(textContent(harness.tree()), /responseFailed/u)

  form = findElement(harness.tree(), (element) => element.type === "form")
  form.props.onSubmit({ preventDefault() {} })
  await settle()
  harness.flush()
  assert.doesNotMatch(textContent(harness.tree()), /responseFailed/u)

  terminal.resolve({
    events: [{ seq: 2, type: "settled", status: "authorized" }],
    nextSeq: 2,
    done: true,
  })
  await settle()
  harness.flush()
  assert.match(textContent(harness.tree()), /authorized/u)
  assert.doesNotMatch(textContent(harness.tree()), /responseFailed|failed/u)
  harness.unmount()
})

test("a terminal watcher event releases response busy state before the response RPC settles", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const terminal = deferred()
  const answered = deferred()
  let watchCalls = 0
  let describeCalls = 0
  const client = {
    describe: async () => {
      describeCalls += 1
      return authorizationStatus(describeCalls > 1)
    },
    start: async () => ({ attemptId: "terminal-race" }),
    watch: async () => {
      watchCalls += 1
      if (watchCalls === 1) {
        return {
          events: [{
            seq: 1,
            type: "prompt",
            promptId: "prompt-race",
            prompt: { kind: "text", message: "Answer" },
          }],
          nextSeq: 1,
          done: false,
        }
      }
      return terminal.promise
    },
    answer: async () => answered.promise,
    decline: async () => ({ accepted: true }),
    cancel: async () => ({ accepted: true }),
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  findElement(harness.tree(), (element) => element.type === "button" && /signIn/u.test(textContent(element))).props.onClick()
  await settle()
  harness.flush()
  findElement(harness.tree(), (element) => element.type === "form").props.onSubmit({ preventDefault() {} })
  harness.flush()

  terminal.resolve({
    events: [{ seq: 2, type: "settled", status: "authorized" }],
    nextSeq: 2,
    done: true,
  })
  await settle()
  harness.flush()
  answered.resolve({ accepted: true })
  await settle()
  harness.flush()

  const signInAgain = findElement(harness.tree(), (element) => element.type === "button" && textContent(element) === "signInAgain")
  assert.equal(signInAgain.props.disabled, false)
  assert.equal(findElement(harness.tree(), (element) => element.type === "section").props["aria-busy"], undefined)
  harness.unmount()
})

test("authorization and model mutations do not update state after unmount", async () => {
  const authorizationHarness = hookHarness()
  const authorizationModule = await loadClientModule(authorizationHarness.React, { confirm: () => true })
  const loggedOut = deferred()
  authorizationHarness.mount(authorizationModule.AuthorizationSettings, {
    client: {
      describe: async () => authorizationStatus(true),
      logout: async () => loggedOut.promise,
    },
    t: (key) => key,
  })
  await settle()
  authorizationHarness.flush()
  findElement(authorizationHarness.tree(), (element) => element.type === "button" && textContent(element) === "signOut").props.onClick()
  authorizationHarness.flush()
  authorizationHarness.unmount()
  loggedOut.resolve({ signedOut: true })
  await settle()
  assert.equal(authorizationHarness.updatesAfterUnmount(), 0)

  const modelHarness = hookHarness()
  const modelModule = await loadClientModule(modelHarness.React)
  const saved = deferred()
  const ready = {
    kind: "ready",
    writable: true,
    revision: 1,
    settingsNs: "dsh-codex",
    settingsPath: [],
    models: [{ id: "gpt-a" }, { id: "gpt-b" }],
    catalogIds: ["gpt-a", "gpt-b"],
    selectedIds: ["gpt-a"],
    configuredModels: [{ id: "gpt-a" }],
  }
  modelHarness.mount(modelModule.ModelEnablementSettings, {
    client: {
      available: true,
      load: async () => ready,
      save: async () => saved.promise,
      subscribe: () => () => undefined,
    },
    t: (key) => key,
  })
  await settle()
  modelHarness.flush()
  const checkboxes = findElements(modelHarness.tree(), (element) => element.type === "input" && element.props.type === "checkbox")
  checkboxes[1].props.onChange()
  modelHarness.flush()
  findElement(modelHarness.tree(), (element) => element.type === "button" && textContent(element) === "modelsSave").props.onClick()
  modelHarness.flush()
  modelHarness.unmount()
  saved.resolve({ ...ready, revision: 2, selectedIds: ["gpt-a", "gpt-b"] })
  await settle()
  assert.equal(modelHarness.updatesAfterUnmount(), 0)
})

test("client styles are owned by apply and removed on unload", async () => {
  const harness = styleDocumentHarness()
  const clientModule = await loadClientModule(
    { createElement: () => undefined },
    {},
    { document: harness.document },
  )
  const dispose = applyClientModule(clientModule)
  assert.equal(harness.styles.length, 1)
  dispose()
  assert.equal(harness.styles.length, 0)
})

test("client style reload refreshes CSS and survives disposal of the old module", async () => {
  const harness = styleDocumentHarness()
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  const oldModule = await loadClientModule(
    { createElement: () => undefined },
    {},
    { document: harness.document, source },
  )
  const disposeOld = applyClientModule(oldModule)
  assert.match(harness.styles[0].textContent, /gap:28px/u)

  const reloadedModule = await loadClientModule(
    { createElement: () => undefined },
    {},
    { document: harness.document, source: source.replace("gap:28px", "gap:29px") },
  )
  const disposeReloaded = applyClientModule(reloadedModule)
  assert.equal(harness.styles.length, 1)
  assert.match(harness.styles[0].textContent, /gap:29px/u)

  disposeOld()
  assert.equal(harness.styles.length, 1)
  disposeReloaded()
  assert.equal(harness.styles.length, 0)
})

test("multiple client instances keep one stylesheet until the last unload", async () => {
  const harness = styleDocumentHarness()
  const clientModule = await loadClientModule(
    { createElement: () => undefined },
    {},
    { document: harness.document },
  )
  const disposeFirst = applyClientModule(clientModule)
  const disposeSecond = applyClientModule(clientModule)
  assert.equal(harness.styles.length, 1)

  disposeFirst()
  assert.equal(harness.styles.length, 1)
  disposeSecond()
  assert.equal(harness.styles.length, 0)
})

test("client styles bound narrow-screen provider text and actions", async () => {
  const harness = styleDocumentHarness()
  const clientModule = await loadClientModule(
    { createElement: () => undefined },
    {},
    { document: harness.document },
  )
  const dispose = applyClientModule(clientModule)
  const { styles } = harness
  assert.equal(styles.length, 1)
  const css = styles[0].textContent
  assert.match(css, /\.dshCodexPanel\{[^}]*min-width:0/u)
  assert.match(css, /\.dshCodexPanel p,[^{]+\{[^}]*overflow-wrap:anywhere/u)
  assert.match(css, /\.dshCodexCode\{[^}]*flex-wrap:wrap/u)
  assert.match(css, /\.dshCodexCode code\{[^}]*max-width:100%[^}]*overflow-wrap:anywhere/u)
  assert.match(css, /\.dshCodexButton\{[^}]*max-width:100%[^}]*white-space:normal/u)
  assert.match(css, /@media\(max-width:480px\)\{\[role=dialog\]:has\(\.dshCodexPage\)\{flex-direction:column\}/u)
  assert.match(css, /\[role=dialog\]:has\(\.dshCodexPage\)>nav>div:last-child\{[^}]*flex-direction:row[^}]*overflow-x:auto/u)
  assert.match(css, /\[role=dialog\]:has\(\.dshCodexPage\)>:not\(nav\)\{[^}]*min-height:0[^}]*overflow:hidden[^}]*flex:1 1 0%/u)
  dispose()
})

test("authorization refresh keeps the newest response when requests settle out of order", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const older = deferred()
  const newer = deferred()
  let describeCalls = 0
  const client = {
    async describe(signal) {
      describeCalls += 1
      if (describeCalls === 1) return authorizationStatus(false)
      if (describeCalls === 2) return older.promise
      assert.equal(describeCalls, 3)
      assert.equal(signal instanceof AbortSignal, true)
      return newer.promise
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  const refresh = findElement(harness.tree(), (element) => element.type === "button" && textContent(element) === "refresh")
  assert.ok(refresh)

  refresh.props.onClick()
  refresh.props.onClick()
  newer.resolve(authorizationStatus(true))
  await settle()
  harness.flush()
  assert.match(textContent(harness.tree()), /signedIn/u)

  older.resolve(authorizationStatus(false))
  await settle()
  harness.flush()
  assert.match(textContent(harness.tree()), /signedIn/u)
  assert.doesNotMatch(textContent(harness.tree()), /signedOut/u)
  harness.unmount()
})

test("authorization start that settles after unmount is cancelled without starting a watcher", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const started = deferred()
  const cancelled = []
  let watchCalls = 0
  const client = {
    describe: async () => authorizationStatus(false),
    start: async () => started.promise,
    watch: async () => {
      watchCalls += 1
      return { events: [], nextSeq: 0, done: true }
    },
    cancel: async (attemptId) => {
      cancelled.push(attemptId)
      return { accepted: true }
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  const signIn = findElement(harness.tree(), (element) => element.type === "button" && /signIn/u.test(textContent(element)))
  assert.ok(signIn)
  signIn.props.onClick()
  harness.unmount()

  started.resolve({ attemptId: "late-attempt" })
  await settle()
  assert.equal(watchCalls, 0)
  assert.deepEqual(cancelled, ["late-attempt"])
})

test("authorization watcher settling after unmount cannot refresh or publish events", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const watched = deferred()
  let describeCalls = 0
  const cancelled = []
  const client = {
    describe: async () => {
      describeCalls += 1
      return authorizationStatus(false)
    },
    start: async () => ({ attemptId: "active-attempt" }),
    watch: async () => watched.promise,
    cancel: async (attemptId) => {
      cancelled.push(attemptId)
      return { accepted: true }
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  const signIn = findElement(harness.tree(), (element) => element.type === "button" && /signIn/u.test(textContent(element)))
  signIn.props.onClick()
  await settle()
  harness.unmount()

  watched.resolve({
    events: [{ seq: 1, type: "notice", notice: { message: "late notice" } }],
    nextSeq: 1,
    done: true,
  })
  await settle()
  assert.equal(describeCalls, 1)
  assert.deepEqual(cancelled, ["active-attempt"])
})

test("quota UI renders an exhausted observation with a validated reset in Chinese and English", async () => {
  const observedAt = Date.now() - 1_000
  const resetAt = Date.now() + 60 * 60_000
  const requestId = "req_quota_ui_fixture"
  const extra = "secret_quota_ui_fixture"

  for (const language of ["zh", "en"]) {
    const { dictionaries, text } = await renderQuotaView({
      status: "exhausted",
      observedAt,
      resetAt,
      requestId,
      diagnostic: extra,
    }, language)
    const messages = dictionaries[language]

    assert.ok(text.includes(messages.quotaExhausted))
    assert.ok(text.includes(messages.quotaObservedAt))
    assert.ok(text.includes(new Date(observedAt).toLocaleString()))
    assert.ok(text.includes(messages.quotaResetAt))
    assert.ok(text.includes(new Date(resetAt).toLocaleString()))
    assert.ok(text.includes(messages.quotaResetIn))
    assert.ok(text.includes(messages.quotaMinutes))
    assert.match(text, language === "zh" ? /账户额度耗尽.*重置时间/u : /account quota was exhausted.*reset time/iu)
    assert.equal(text.includes(messages.quotaUnknown), false)
    assert.equal(text.includes(messages.quotaNoReset), false)
    assert.equal(text.includes(requestId), false)
    assert.equal(text.includes(extra), false)
  }
})

test("quota UI renders an exhausted observation without reset in Chinese and English", async () => {
  const observedAt = Date.now() - 1_000
  const requestId = "req_quota_ui_without_reset_fixture"
  const extra = "secret_quota_ui_without_reset_fixture"

  for (const language of ["zh", "en"]) {
    const { dictionaries, text } = await renderQuotaView({
      status: "exhausted",
      observedAt,
      requestId,
      diagnostic: extra,
    }, language)
    const messages = dictionaries[language]

    assert.ok(text.includes(messages.quotaExhausted))
    assert.ok(text.includes(messages.quotaObservedAt))
    assert.ok(text.includes(new Date(observedAt).toLocaleString()))
    assert.ok(text.includes(messages.quotaNoReset))
    assert.match(text, language === "zh" ? /账户额度耗尽.*未获得通过校验的重置时间/u : /account quota was exhausted.*no reset time passed validation/iu)
    assert.equal(text.includes(messages.quotaResetAt), false)
    assert.equal(text.includes(messages.quotaUnknown), false)
    assert.equal(text.includes(requestId), false)
    assert.equal(text.includes(extra), false)
  }
})

test("quota UI renders a recent success observation in Chinese and English", async () => {
  const observedAt = Date.now() - 1_000
  const requestId = "req_quota_ui_recent_success_fixture"
  const extra = "secret_quota_ui_recent_success_fixture"

  for (const language of ["zh", "en"]) {
    const { dictionaries, text } = await renderQuotaView({
      status: "recent-success",
      observedAt,
      requestId,
      diagnostic: extra,
    }, language)
    const messages = dictionaries[language]

    assert.ok(text.includes(messages.quotaRecentSuccess))
    assert.ok(text.includes(messages.quotaSuccessCaution))
    assert.ok(text.includes(new Date(observedAt).toLocaleString()))
    assert.match(text, language === "zh" ? /最近一次 Codex 请求成功.*不代表账户剩余额度/u : /latest Codex request succeeded.*does not represent remaining account quota/iu)
    assert.equal(text.includes(messages.quotaExhausted), false)
    assert.equal(text.includes(messages.quotaUnknown), false)
    assert.equal(text.includes(requestId), false)
    assert.equal(text.includes(extra), false)
  }
})

test("quota presentation accepts only bounded timestamp shapes and expires observed resets", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const now = Date.parse("2026-08-27T08:00:00.000Z")

  assert.deepEqual(plain(clientModule.safeQuotaSnapshot(null, now)), { status: "unknown" })
  assert.deepEqual(plain(clientModule.safeQuotaSnapshot({
    status: "recent-success",
    observedAt: now - 1_000,
    unexpected: "not reflected",
  }, now)), {
    status: "recent-success",
    observedAt: now - 1_000,
  })
  assert.deepEqual(plain(clientModule.safeQuotaSnapshot({
    status: "exhausted",
    observedAt: now - 2_000,
    resetAt: now + 60_001,
  }, now)), {
    status: "exhausted",
    observedAt: now - 2_000,
    resetAt: now + 60_001,
    remainingMinutes: 2,
  })
  assert.deepEqual(plain(clientModule.safeQuotaSnapshot({
    status: "exhausted",
    observedAt: now - 2_000,
    resetAt: now,
  }, now)), { status: "unknown" })
})

test("model enablement client reads the plugin-owned Codex settings namespace directly", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const calls = []
  const signal = new AbortController().signal
  const ok = (value) => ({ result: { ok: true, value } })
  const connection = {
    api: {
      llm: {
        async discoverModels(payload, receivedSignal) {
          calls.push({ method: "discoverModels", payload, signal: receivedSignal })
          return ok({
            models: [
              { id: "gpt-a", name: "GPT A", ignored: true },
              { id: "gpt-b", name: "GPT B" },
              { id: "gpt-a", name: "duplicate" },
            ],
          })
        },
      },
      settings: {
        async mutate() {
          throw new Error("not used")
        },
      },
    },
  }

  const mirror = settingsMirror({
    writable: false,
    namespaces: [{
      ns: "dsh-codex",
      revision: 17,
      user: {
        models: [{ id: "gpt-a", futureField: { enabled: true } }],
      },
      value: {},
    }],
  }, { onEnsure: () => calls.push({ method: "ensure" }) })
  const client = clientModule.createModelEnablementClient(connection, mirror)
  const snapshot = await client.load(signal)

  assert.equal(client.available, true)
  assert.equal(snapshot.kind, "ready")
  assert.equal(snapshot.writable, false)
  assert.equal(snapshot.revision, 17)
  assert.equal(snapshot.settingsNs, "dsh-codex")
  assert.deepEqual([...snapshot.settingsPath], [])
  assert.deepEqual(plain(snapshot.models), [
    { id: "gpt-a", name: "GPT A" },
    { id: "gpt-b", name: "GPT B" },
  ])
  assert.deepEqual([...snapshot.catalogIds], ["gpt-a", "gpt-b"])
  assert.deepEqual([...snapshot.selectedIds], ["gpt-a"])
  assert.deepEqual(plain(snapshot.configuredModels), [
    { id: "gpt-a", futureField: { enabled: true } },
  ])
  assert.deepEqual(calls.map((call) => call.method), ["discoverModels", "ensure"])
  assert.deepEqual(plain(calls[0].payload), { settingsNs: "dsh-codex", provider: "dsh-codex" })
  assert.equal(calls[0].signal, signal)
})

test("an explicit empty plugin model list remains empty instead of looking unset", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const ok = (value) => ({ result: { ok: true, value } })
  const client = clientModule.createModelEnablementClient({
    api: {
      llm: {
        discoverModels: async () => ok({ models: [{ id: "gpt-a" }, { id: "gpt-b" }] }),
      },
      settings: { mutate: async () => ok({ revision: 2 }) },
    },
  }, settingsMirror({
    writable: true,
    namespaces: [{
      ns: "dsh-codex",
      revision: 1,
      user: { models: [] },
      value: { models: [] },
    }],
  }))

  const snapshot = await client.load()
  assert.deepEqual([...snapshot.selectedIds], [])
  assert.deepEqual([...snapshot.configuredModels], [])
})

test("partial model selection preserves known rows and creates minimal new rows", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const mutations = []
  const ok = (value) => ({ result: { ok: true, value } })
  const connection = {
    api: {
      llm: {
        providers: async () => ok({ providers: [] }),
        discoverModels: async () => ok({ models: [] }),
      },
      settings: {
        describe: async () => ok({ namespaces: [] }),
        async mutate(payload, signal) {
          mutations.push({ payload, signal })
          return ok({ revision: 24, user: {} })
        },
      },
    },
  }
  const acceptedViews = []
  const mirror = settingsMirror(
    { writable: true, namespaces: [] },
    { onAccept: (view) => acceptedViews.push(view) },
  )
  const client = clientModule.createModelEnablementClient(connection, mirror)
  let mirrorNotifications = 0
  const unsubscribe = client.subscribe(() => {
    mirrorNotifications += 1
  })
  const snapshot = {
    kind: "ready",
    writable: true,
    revision: 23,
    settingsNs: "llm-pi-ai",
    settingsPath: ["providers", "openai-codex"],
    models: [{ id: "gpt-a" }, { id: "gpt-b" }, { id: "gpt-c" }],
    catalogIds: ["gpt-a", "gpt-b", "gpt-c"],
    selectedIds: ["gpt-a"],
    configuredModels: [{ id: "gpt-a", futureField: { preserved: true }, maxTokens: 42 }],
  }
  const signal = new AbortController().signal

  const saved = await client.save(snapshot, ["gpt-c", "gpt-a"], signal)

  assert.equal(saved.revision, 24)
  assert.deepEqual([...saved.selectedIds], ["gpt-a", "gpt-c"])
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].signal, signal)
  assert.equal(acceptedViews.length, 1)
  assert.equal(acceptedViews[0].revision, 24)
  assert.equal(mirrorNotifications, 1)
  unsubscribe()
  assert.deepEqual(plain(mutations[0].payload), {
    ns: "llm-pi-ai",
    ops: [{
      op: "set",
      path: ["providers", "openai-codex", "models"],
      value: [
        { id: "gpt-a", futureField: { preserved: true }, maxTokens: 42 },
        { id: "gpt-c" },
      ],
    }],
    expectedRevision: 23,
  })
})

test("all enabled models preserve rich model rows and an empty selection never writes", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const mutations = []
  const ok = (value) => ({ result: { ok: true, value } })
  const connection = {
    api: {
      llm: {
        providers: async () => ok({ providers: [] }),
        discoverModels: async () => ok({ models: [] }),
      },
      settings: {
        describe: async () => ok({ namespaces: [] }),
        async mutate(payload) {
          mutations.push(payload)
          return ok({ revision: 8 })
        },
      },
    },
  }
  const client = clientModule.createModelEnablementClient(
    connection,
    settingsMirror({ writable: true, namespaces: [] }),
  )
  const snapshot = {
    kind: "ready",
    writable: true,
    revision: 7,
    settingsNs: "custom-settings",
    settingsPath: ["routes", "codex"],
    models: [{ id: "gpt-a" }, { id: "gpt-b" }],
    catalogIds: ["gpt-a", "gpt-b"],
    selectedIds: ["gpt-a"],
    configuredModels: [{
      id: "gpt-a",
      contextWindow: 200_000,
      maxTokens: 100_000,
      compat: { supportsReasoning: true },
      unknown: { preserve: true },
    }],
  }

  await assert.rejects(
    client.save(snapshot, []),
    (error) => error.code === "AT_LEAST_ONE_MODEL",
  )
  assert.equal(mutations.length, 0)

  await client.save(snapshot, ["gpt-b", "gpt-a"])
  assert.deepEqual(plain(mutations), [{
    ns: "custom-settings",
    ops: [{
      op: "set",
      path: ["routes", "codex", "models"],
      value: [
        {
          id: "gpt-a",
          contextWindow: 200_000,
          maxTokens: 100_000,
          compat: { supportsReasoning: true },
          unknown: { preserve: true },
        },
        { id: "gpt-b" },
      ],
    }],
    expectedRevision: 7,
  }])
})

test("all enabled id-only rows unset the override to follow future catalog additions", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const mutations = []
  const ok = (value) => ({ result: { ok: true, value } })
  const client = clientModule.createModelEnablementClient({
    api: {
      llm: {
        providers: async () => ok({ providers: [] }),
        discoverModels: async () => ok({ models: [] }),
      },
      settings: {
        describe: async () => ok({ namespaces: [] }),
        async mutate(payload) {
          mutations.push(payload)
          return ok({ revision: 12 })
        },
      },
    },
  }, settingsMirror({ writable: true, namespaces: [] }))
  const snapshot = {
    kind: "ready",
    writable: true,
    revision: 11,
    settingsNs: "llm-pi-ai",
    settingsPath: ["providers", "openai-codex"],
    models: [{ id: "gpt-a" }, { id: "gpt-b" }],
    catalogIds: ["gpt-a", "gpt-b"],
    selectedIds: ["gpt-a"],
    configuredModels: [{ id: "gpt-a" }],
  }

  const saved = await client.save(snapshot, ["gpt-b", "gpt-a"])

  assert.deepEqual(plain(mutations), [{
    ns: "llm-pi-ai",
    ops: [{ op: "unset", path: ["providers", "openai-codex", "models"] }],
    expectedRevision: 11,
  }])
  assert.equal(saved.revision, 12)
  assert.deepEqual([...saved.selectedIds], ["gpt-a", "gpt-b"])
  assert.deepEqual([...saved.configuredModels], [])
})

test("custom configured models remain selectable and are never removed by catalog reset", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))
  const mutations = []
  const ok = (value) => ({ result: { ok: true, value } })
  const connection = {
    api: {
      llm: {
        discoverModels: async () => ok({ models: [{ id: "catalog-model" }] }),
      },
      settings: {
        async mutate(payload) {
          mutations.push(payload)
          return ok({ revision: 4 })
        },
      },
    },
  }

  const client = clientModule.createModelEnablementClient(connection, settingsMirror({
    writable: true,
    namespaces: [{
      ns: "dsh-codex",
      revision: 3,
      user: {
        models: [
          { id: "catalog-model" },
          { id: "custom-model", name: "Custom model", futureField: true },
        ],
      },
      value: {},
    }],
  }))
  const snapshot = await client.load()
  assert.deepEqual(plain(snapshot.models), [
    { id: "catalog-model" },
    { id: "custom-model", name: "Custom model" },
  ])
  assert.deepEqual([...snapshot.catalogIds], ["catalog-model"])

  await client.save(snapshot, ["catalog-model", "custom-model"])
  assert.equal(mutations[0].ops[0].op, "set")
  assert.deepEqual(plain(mutations[0].ops[0].value), [
    { id: "catalog-model" },
    { id: "custom-model", name: "Custom model", futureField: true },
  ])
})

test("model enablement gracefully reports missing APIs and result errors", async () => {
  const source = await readFile(new URL("../src/client/index.js", import.meta.url), "utf8")
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (spec) => { registration = spec } } },
  })
  const clientModule = registration.factory(() => ({ createElement: () => undefined }))

  const missing = clientModule.createModelEnablementClient({})
  assert.equal(missing.available, false)
  assert.deepEqual({ ...(await missing.load()) }, { kind: "unavailable" })

  const withoutMirror = clientModule.createModelEnablementClient({
    api: {
      llm: {
        providers: async () => ({ result: { ok: true, value: { providers: [] } } }),
        discoverModels: async () => ({ result: { ok: true, value: { models: [] } } }),
      },
      settings: {
        mutate: async () => ({ result: { ok: true, value: {} } }),
      },
    },
  })
  assert.equal(withoutMirror.available, false)
  assert.deepEqual({ ...(await withoutMirror.load()) }, { kind: "unavailable" })

  const failed = clientModule.createModelEnablementClient({
    api: {
      llm: {
        discoverModels: async () => ({ result: { ok: false, error: { message: "model discovery failed" } } }),
      },
      settings: {
        mutate: async () => ({ result: { ok: true, value: {} } }),
      },
    },
  }, settingsMirror({ writable: true, namespaces: [] }))
  await assert.rejects(failed.load(), /model discovery failed/)
})

test("package manifest exports the real classic bundle with required client injections", async () => {
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
  assert.equal(manifest.exports["./client"].default, "./dist/client/index.js")
  assert.deepEqual(manifest.dsh.client, {
    inject: [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-locale",
    ],
    platform: "web",
  })
})
