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

function hookHarness(options = {}) {
  const hooks = []
  let component
  let props
  let hookIndex = 0
  let tree
  let dirty = false
  let pendingEffects = []
  let unmounted = false
  let updatesAfterUnmount = 0
  const assignedRefs = new Set()

  const assignHostRefs = (value) => {
    if (typeof options.createHostNode !== "function") return
    if (value === null || value === undefined || value === false) return
    if (Array.isArray(value)) {
      for (const child of value) assignHostRefs(child)
      return
    }
    if (typeof value !== "object") return
    const ref = value.props?.ref
    if (typeof value.type === "string" && ref !== undefined) {
      const node = options.createHostNode(value)
      if (typeof ref === "function") ref(node)
      else if (typeof ref === "object" && ref !== null) ref.current = node
      assignedRefs.add(ref)
    }
    assignHostRefs(value.children)
  }

  const clearHostRefs = () => {
    for (const ref of assignedRefs) {
      if (typeof ref === "function") ref(null)
      else if (typeof ref === "object" && ref !== null) ref.current = null
    }
    assignedRefs.clear()
  }

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
    useId() {
      const index = hookIndex++
      if (hooks[index] === undefined) hooks[index] = { kind: "id", value: `:test-${index}:` }
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
    clearHostRefs()
    hookIndex = 0
    pendingEffects = []
    dirty = false
    tree = component(props)
    assignHostRefs(tree)
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
      clearHostRefs()
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
  const globals = { AbortController, Blob, URL, window, ...options.globals }
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

function requestDefaultsScope(value, { writable = true, status = "ready" } = {}) {
  let snapshot = { status, value, writable }
  const listeners = new Set()
  const writes = []
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async set(field, nextValue) {
      writes.push({ field, value: nextValue })
      snapshot = {
        ...snapshot,
        status: "ready",
        value: { ...snapshot.value, [field]: nextValue },
      }
      for (const listener of listeners) listener()
    },
    writes,
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
  assert.equal(clientModule.DIAGNOSTICS_CHANNEL, "/dsh-codex-diagnostics")
  assert.equal(clientModule.NS, "settings.codex")

  const dictionaries = []
  const sections = []
  const injectedSlots = []
  const defaultsScope = requestDefaultsScope({
    defaultFast: false,
    defaultTransport: "auto",
    defaultTextVerbosity: "low",
    defaultReasoningSummary: "auto",
  })
  const context = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    settingsScope: {
      describe: () => settingsMirror({ writable: true, namespaces: [] }),
      bind(spec) {
        assert.deepEqual(plain(spec), { namespace: "dsh-codex" })
        return defaultsScope
      },
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
    inject(services, callback) {
      assert.deepEqual([...services], ["slots", "modelDirectories"])
      callback({
        slots: context.slots,
        modelDirectories: {
          directoryFor: () => ({
            store: { getSnapshot: () => ({ current: null }) },
            select: async () => undefined,
          }),
        },
      })
    },
  }
  clientModule.apply(context)

  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0].namespace, "settings.codex")
  assert.equal(dictionaries[0].value.zh.title, "OpenAI Codex")
  assert.equal(dictionaries[0].value.en.title, "OpenAI Codex")
  assert.equal(dictionaries[0].value.zh.nav, "OpenAI Codex")
  assert.equal(dictionaries[0].value.en.nav, "OpenAI Codex")
  assert.equal(dictionaries[0].value.zh.signInWithChatGPT, "使用 ChatGPT 登录")
  assert.equal(dictionaries[0].value.en.signInWithChatGPT, "Sign in with ChatGPT")
  assert.match(
    dictionaries[0].value.zh.legacyReasoningRepair,
    /新会话.*默认模型/u,
  )
  assert.match(
    dictionaries[0].value.zh.legacyReasoningRepairRetry,
    /新会话.*默认模型/u,
  )
  assert.match(
    dictionaries[0].value.zh.legacyReasoningRepairHelp,
    /模型选择器.*未来新会话.*默认模型/u,
  )
  assert.match(
    dictionaries[0].value.en.legacyReasoningRepair,
    /future.*default/iu,
  )
  assert.match(
    dictionaries[0].value.en.legacyReasoningRepairRetry,
    /future.*default/iu,
  )
  assert.match(
    dictionaries[0].value.en.legacyReasoningRepairHelp,
    /model selector.*default model.*future (?:new )?conversations/iu,
  )
  assert.deepEqual(
    Object.keys(dictionaries[0].value.zh).sort(),
    Object.keys(dictionaries[0].value.en).sort(),
  )
  assert.deepEqual(injectedSlots, ["settings.section", "conversation.input.right"])
  assert.equal(sections.length, 2)
  const settingsSection = sections.find(({ spec }) => spec.name === "settings.section")
  const fastEntry = sections.find(({ spec }) => spec.name === "conversation.input.right")
  assert.ok(settingsSection)
  assert.equal(settingsSection.spec.id, "codex")
  assert.equal(settingsSection.spec.order, 15)
  assert.equal(settingsSection.spec.label(), "nav")
  assert.equal(typeof settingsSection.component, "function")
  assert.equal(settingsSection.spec.inject().modelClient.available, false)
  assert.ok(fastEntry)
  assert.equal(fastEntry.spec.id, "dsh-codex-fast")
  assert.equal(fastEntry.spec.order, 100)
  assert.equal(fastEntry.spec.locale, "settings.codex")
  const fastProps = fastEntry.spec.inject("session-fast-entry")
  assert.equal(typeof fastProps.preferenceClient.get, "function")
  assert.equal(typeof fastProps.preferenceClient.getForModel, "function")
  assert.equal(typeof fastProps.preferenceClient.setFast, "function")
  assert.equal(typeof fastProps.preferenceClient.setTransport, "function")
  assert.equal(typeof fastProps.selectModel, "function")
  assert.equal(fastProps.hooks.modelDirectory.getSnapshot().current, null)
  assert.match(dictionaries[0].value.zh.modelsDescription, /模型选择器.*provider catalog.*已有会话/u)
  assert.match(dictionaries[0].value.en.modelsDescription, /model selector.*installed provider catalog.*existing conversations/iu)
  assert.equal(dictionaries[0].value.zh.modelsTitle, "当前安装的 Codex 模型")
  assert.equal(dictionaries[0].value.en.modelsTitle, "Codex models in this installation")
  assert.match(dictionaries[0].value.zh.modelsAllEnabledFollow, /清除列表覆盖.*未来新增模型/u)
  assert.match(dictionaries[0].value.zh.modelsAllEnabledPreserve, /保留其他模型参数.*未来新增模型/u)
  assert.match(dictionaries[0].value.en.modelsAllEnabledFollow, /clears the list override.*future models/iu)
  assert.match(dictionaries[0].value.en.modelsAllEnabledPreserve, /preserve other model settings.*future models/iu)
  assert.equal(dictionaries[0].value.zh.refreshing, "刷新中…")
  assert.equal(dictionaries[0].value.en.refreshing, "Refreshing…")
  assert.equal(dictionaries[0].value.zh.modelsShowMore, "显示未选择的 {count} 个模型")
  assert.equal(dictionaries[0].value.en.modelsShowMore, "Show {count} unselected models")
  assert.equal(dictionaries[0].value.zh.modelsSummary, "已选择 {selected}/{total} · 当前显示 {visible}/{total}")
  assert.equal(dictionaries[0].value.en.modelsSummary, "Selected {selected}/{total} · Showing {visible}/{total}")
  assert.equal(dictionaries[0].value.zh.transportMenu, "当前会话的传输方式")
  assert.equal(dictionaries[0].value.en.transportMenu, "Transport for this conversation")
  assert.match(dictionaries[0].value.zh.transportResetLabel, /当前会话.*自动/u)
  assert.match(dictionaries[0].value.en.transportResetLabel, /conversation.*Auto/iu)
  assert.match(dictionaries[0].value.zh.diagnosticsLocalHelp, /不联网.*不刷新凭据.*不发送模型请求/u)
  assert.match(dictionaries[0].value.zh.diagnosticsAccountHelp, /刷新 OAuth.*不发送模型请求.*不消耗额度/u)
  assert.match(dictionaries[0].value.en.diagnosticsLocalHelp, /No network.*credential refresh.*model request/iu)
  assert.match(dictionaries[0].value.en.diagnosticsAccountHelp, /refreshes OAuth.*never sends a model request.*consumes usage/iu)
  assert.match(dictionaries[0].value.zh.diagnosticsNetworkConsentHelp, /一次真实 Codex 请求.*消耗额度.*SSE.*关闭 Fast.*短提示.*不携带当前会话内容或工具.*不会自动重试.*没有可用的服务端硬输出上限.*首次看到模型文本.*不能保证.*未消耗额度/u)
  assert.match(dictionaries[0].value.en.diagnosticsNetworkConsentHelp, /one real Codex request.*consumes usage.*SSE.*Fast off.*short prompt.*no conversation history or tools.*no automatic retry.*no usable server-side hard output limit.*first visible model text.*cannot guarantee.*usage/iu)
  assert.equal(dictionaries[0].value.zh.diagnosticsNetworkConfirm, "我了解会消耗额度，执行一次")
  assert.equal(dictionaries[0].value.en.diagnosticsNetworkConfirm, "I understand this consumes usage; run once")
  assert.match(dictionaries[0].value.zh.diagnosticsHistoryHelp, /点击后.*最多 20 条.*脱敏.*不会自动加载/u)
  assert.match(dictionaries[0].value.en.diagnosticsHistoryHelp, /up to 20 sanitized reports.*after you click.*never loads automatically/iu)
  assert.equal(typeof settingsSection.spec.inject().diagnosticsClient.run, "function")
  assert.equal(typeof settingsSection.spec.inject().diagnosticsClient.prepareNetwork, "function")
  assert.equal(typeof settingsSection.spec.inject().diagnosticsClient.runNetwork, "function")
  assert.equal(typeof settingsSection.spec.inject().diagnosticsClient.history, "function")
  assert.equal(typeof settingsSection.spec.inject().diagnosticsClient.clearHistory, "function")
  assert.equal(typeof settingsSection.spec.inject().defaultsClient.set, "function")
})

test("settings page keeps one hero above authorization, diagnostics, request defaults, and models", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const page = clientModule.CodexSettings({
    client: {},
    diagnosticsClient: {},
    modelClient: {},
    defaultsClient: {},
    t: (key) => key,
  })

  assert.equal(page.type, "div")
  assert.equal(page.props.className, "dshCodexPage")
  const hero = findElement(page, (element) => element.type === "header" && element.props.className === "dshCodexHero")
  assert.ok(hero)
  assert.equal(findElements(hero, (element) => element.type === "h2").length, 1)
  assert.match(textContent(hero), /titledescription/u)
  assert.equal(page.children[1].type, clientModule.AuthorizationSettings)
  assert.equal(page.children[2].type, clientModule.ConnectionDiagnosticsSettings)
  assert.equal(page.children[3].type, clientModule.GlobalRequestDefaultsSettings)
  assert.equal(page.children[4].type, clientModule.ModelEnablementSettings)
})

test("global request defaults expose full-row native selectors with current values and ARIA labels", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  const scope = requestDefaultsScope({
    defaultFast: false,
    defaultTransport: "auto",
    defaultTextVerbosity: "low",
    defaultReasoningSummary: "auto",
  })

  harness.mount(clientModule.GlobalRequestDefaultsSettings, {
    client: clientModule.createGlobalRequestDefaultsClient(scope),
    t: (key) => dictionaries.en[key] ?? key,
  })
  const tree = harness.flush()
  const title = findElement(tree, (element) => element.type === "h3"
    && textContent(element) === "Global request defaults")
  const group = findElement(tree, (element) => element.props.role === "group")
  assert.ok(title?.props.id)
  assert.equal(group.props["aria-labelledby"], title.props.id)

  const rows = findElements(tree, (element) => element.type === "label"
    && element.props.className?.includes("dshCodexDefaultsRow"))
  assert.equal(rows.length, 4)

  const fastRow = rows.find(({ props }) => props.className.includes("dshCodexDefaultsFastRow"))
  const fastInput = findElement(fastRow, (element) => element.type === "input"
    && element.props.type === "checkbox")
  const fastLabel = findElement(fastRow, (element) => element.type === "span"
    && element.props.className === "dshCodexDefaultsLabel")
  assert.equal(fastRow.props.htmlFor, fastInput.props.id)
  assert.equal(fastInput.props["aria-labelledby"], fastLabel.props.id)
  assert.equal(fastRow.props["data-checked"], "false")

  const selectRows = rows.filter(({ props }) => props.className.includes("dshCodexDefaultsSelectRow"))
  assert.equal(selectRows.length, 3)
  assert.deepEqual(selectRows.map((row) => {
    const select = findElement(row, (element) => element.type === "select")
    const label = findElement(row, (element) => element.type === "span"
      && element.props.className === "dshCodexDefaultsLabel")
    const visual = findElement(row, (element) => element.type === "span"
      && element.props.className === "dshCodexDefaultsSelectVisual")
    const current = findElement(row, (element) => element.type === "span"
      && element.props.className === "dshCodexDefaultsSelectCurrent")
    assert.equal(row.props.htmlFor, select.props.id)
    assert.equal(select.props.className, "dshCodexDefaultsNativeSelect")
    assert.equal(select.props["aria-labelledby"], label.props.id)
    assert.equal(select.props.disabled, false)
    assert.equal(visual.props["aria-hidden"], "true")
    assert.ok(findElement(visual, (element) => element.type === "svg"))
    return textContent(current)
  }), ["Auto", "Concise", "Auto"])
  harness.unmount()
})

test("global request defaults bind one Codex namespace and save each field independently", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  const scope = requestDefaultsScope({
    defaultFast: false,
    defaultTransport: "auto",
    defaultTextVerbosity: "low",
    defaultReasoningSummary: "auto",
  })
  const client = clientModule.createGlobalRequestDefaultsClient(scope)

  harness.mount(clientModule.GlobalRequestDefaultsSettings, {
    client,
    t: (key) => dictionaries.en[key] ?? key,
  })
  harness.flush()
  assert.match(textContent(harness.tree()), /Global request defaults/u)
  assert.match(textContent(harness.tree()), /existing conversations.*next request.*already in progress.*unchanged/u)

  let controls = findElements(
    harness.tree(),
    (element) => (element.type === "input" && element.props.type === "checkbox") || element.type === "select",
  )
  assert.equal(controls.length, 4)
  assert.equal(controls[0].props.checked, false)
  assert.deepEqual(controls.slice(1).map(({ props }) => props.value), ["auto", "low", "auto"])

  controls[0].props.onChange({ target: { checked: true } })
  await settle()
  harness.flush()
  controls = findElements(
    harness.tree(),
    (element) => (element.type === "input" && element.props.type === "checkbox") || element.type === "select",
  )
  controls[1].props.onChange({ target: { value: "websocket" } })
  await settle()
  harness.flush()
  controls = findElements(
    harness.tree(),
    (element) => (element.type === "input" && element.props.type === "checkbox") || element.type === "select",
  )
  controls[2].props.onChange({ target: { value: "high" } })
  await settle()
  harness.flush()
  controls = findElements(
    harness.tree(),
    (element) => (element.type === "input" && element.props.type === "checkbox") || element.type === "select",
  )
  controls[3].props.onChange({ target: { value: "detailed" } })
  await settle()
  harness.flush()

  assert.deepEqual(plain(scope.writes), [
    { field: "defaultFast", value: true },
    { field: "defaultTransport", value: "websocket" },
    { field: "defaultTextVerbosity", value: "high" },
    { field: "defaultReasoningSummary", value: "detailed" },
  ])
  assert.equal(scope.writes.every(({ field }) => typeof field === "string"), true)
  assert.match(textContent(harness.tree()), /Enable Fast \(1\.5×\) by default/u)
  assert.deepEqual(findElements(
    harness.tree(),
    (element) => element.props.className === "dshCodexDefaultsSelectCurrent",
  ).map(textContent), ["WebSocket", "Detailed", "Detailed"])
  harness.unmount()
})

test("global request defaults show unavailable and read-only states without attempting writes", async () => {
  const unavailableHarness = hookHarness()
  const unavailableModule = await loadClientModule(unavailableHarness.React)
  const dictionaries = registeredClientDictionaries(unavailableModule)
  unavailableHarness.mount(unavailableModule.GlobalRequestDefaultsSettings, {
    client: unavailableModule.createGlobalRequestDefaultsClient(),
    t: (key) => dictionaries.zh[key] ?? key,
  })
  unavailableHarness.flush()
  assert.match(textContent(unavailableHarness.tree()), /没有可用.*默认值设置接口/u)
  assert.equal(findElements(unavailableHarness.tree(), (element) => element.type === "select").length, 0)
  unavailableHarness.unmount()

  const readOnlyHarness = hookHarness()
  const readOnlyModule = await loadClientModule(readOnlyHarness.React)
  const readOnlyScope = requestDefaultsScope({
    defaultFast: false,
    defaultTransport: "auto",
    defaultTextVerbosity: "low",
    defaultReasoningSummary: "auto",
  }, { writable: false })
  readOnlyHarness.mount(readOnlyModule.GlobalRequestDefaultsSettings, {
    client: readOnlyModule.createGlobalRequestDefaultsClient(readOnlyScope),
    t: (key) => dictionaries.zh[key] ?? key,
  })
  readOnlyHarness.flush()
  assert.match(textContent(readOnlyHarness.tree()), /设置存储为只读/u)
  const controls = findElements(
    readOnlyHarness.tree(),
    (element) => (element.type === "input" && element.props.type === "checkbox") || element.type === "select",
  )
  assert.equal(controls.length, 4)
  assert.equal(controls.every(({ props }) => props.disabled), true)
  const rows = findElements(
    readOnlyHarness.tree(),
    (element) => element.type === "label" && element.props.className?.includes("dshCodexDefaultsRow"),
  )
  assert.equal(rows.length, 4)
  assert.equal(rows.every(({ props }) => props["data-disabled"] === "true"), true)
  assert.deepEqual(readOnlyScope.writes, [])
  readOnlyHarness.unmount()
})

test("global request defaults reject malformed ready snapshots", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const valid = {
    defaultFast: false,
    defaultTransport: "auto",
    defaultTextVerbosity: "low",
    defaultReasoningSummary: "auto",
  }
  const malformed = [
    [],
    { defaultFast: "yes" },
    { ...valid, defaultTransport: "http" },
    { ...valid, defaultTextVerbosity: "verbose" },
    { ...valid, defaultReasoningSummary: "full" },
  ]

  for (const value of malformed) {
    const client = clientModule.createGlobalRequestDefaultsClient(requestDefaultsScope(value))
    assert.deepEqual(plain(client.load()), { kind: "unavailable" })
  }

  const client = clientModule.createGlobalRequestDefaultsClient(requestDefaultsScope({
    ...valid,
    futureSetting: true,
  }))
  assert.deepEqual(plain(client.load()), {
    kind: "ready",
    writable: true,
    value: valid,
  })
})

test("global request defaults disable controls while a field write is saving", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  const pending = deferred()
  const listeners = new Set()
  const scope = {
    getSnapshot: () => ({
      status: "ready",
      writable: true,
      value: {
        defaultFast: false,
        defaultTransport: "auto",
        defaultTextVerbosity: "low",
        defaultReasoningSummary: "auto",
      },
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: () => pending.promise,
  }
  harness.mount(clientModule.GlobalRequestDefaultsSettings, {
    client: clientModule.createGlobalRequestDefaultsClient(scope),
    t: (key) => dictionaries.en[key] ?? key,
  })
  harness.flush()
  findElement(harness.tree(), (element) => element.type === "input" && element.props.type === "checkbox")
    .props.onChange({ target: { checked: true } })
  harness.flush()
  assert.match(textContent(harness.tree()), /Saving…/u)
  const savingControls = findElements(
    harness.tree(),
    (element) => (element.type === "input" && element.props.type === "checkbox") || element.type === "select",
  )
  assert.equal(savingControls.every(({ props }) => props.disabled), true)
  assert.equal(findElements(
    harness.tree(),
    (element) => element.type === "label" && element.props.className?.includes("dshCodexDefaultsRow"),
  ).every(({ props }) => props["data-disabled"] === "true"), true)
  pending.resolve()
  await settle()
  harness.flush()
  const savedControls = findElements(
    harness.tree(),
    (element) => (element.type === "input" && element.props.type === "checkbox") || element.type === "select",
  )
  assert.equal(savedControls.every(({ props }) => props.disabled === false), true)
  harness.unmount()
})

test("connection diagnostics stay collapsed and idle until explicitly requested", async () => {
  const harness = hookHarness()
  const copied = []
  const clientModule = await loadClientModule(harness.React, {
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
  })
  const pending = []
  const calls = []
  const connection = {
    rpc: {
      call(channel, endpoint, payload, signal) {
        const request = deferred()
        pending.push(request)
        calls.push({ channel, endpoint, payload, signal })
        return request.promise
      },
    },
  }
  const translate = (key) => key === "locale" ? "en-US" : key
  harness.mount(clientModule.ConnectionDiagnosticsSettings, {
    client: clientModule.createConnectionDiagnosticsClient(connection),
    t: translate,
  })

  let tree = harness.tree()
  const toggle = findElement(tree, (element) => element.type === "button"
    && element.props.className === "dshCodexDiagnosticsToggle")
  assert.equal(toggle.props["aria-expanded"], "false")
  assert.equal(calls.length, 0, "opening settings must not run diagnostics")
  assert.equal(findElement(tree, (element) => textContent(element) === "diagnosticsLocal"), undefined)

  toggle.props.onClick()
  tree = harness.flush()
  assert.equal(findElement(tree, (element) => element.type === "button"
    && element.props.className === "dshCodexDiagnosticsToggle").props["aria-expanded"], "true")
  assert.match(textContent(tree), /diagnosticsLocalHelp/u)
  assert.match(textContent(tree), /diagnosticsAccountHelp/u)
  assert.equal(calls.length, 0, "expanding diagnostics must remain side-effect free")

  const localButton = findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsLocal")
  localButton.props.onClick()
  tree = harness.flush()
  assert.equal(calls.length, 1)
  assert.deepEqual({ ...calls[0].payload }, { mode: "local" })
  assert.equal(textContent(findElement(tree, (element) => element.type === "button"
    && element.props["aria-busy"] === "true")), "diagnosticsLocalRunning")
  assert.equal(findElements(tree, (element) => element.type === "button"
    && element.props.disabled === true).length, 3)

  const secret = "raw-host-diagnostic-secret"
  pending[0].resolve({
    ok: true,
    value: {
      version: 2,
      mode: "local",
      outcome: "warning",
      observedAt: 1,
      rawError: secret,
      checks: [
        {
          id: "runtime",
          status: "pass",
          code: "runtime-ready",
          facts: { route: "dsh-codex", registered: true },
          message: secret,
        },
        {
          id: "credential",
          status: "warning",
          code: "credential-signed-out",
          facts: { configured: false, state: "signed-out", writable: true },
        },
        {
          id: "models",
          status: "pass",
          code: "models-ready",
          facts: { catalogCount: 7, enabledCount: 7, selection: "all", allEnabled: true },
        },
      ],
    },
  })
  await settle()
  tree = harness.flush()
  const rendered = textContent(tree)
  assert.match(rendered, /diagnosticsOutcomeWarning/u)
  assert.match(rendered, /runtime-ready/u)
  assert.match(rendered, /route=dsh-codex/u)
  assert.match(rendered, /credential-signed-out/u)
  assert.equal(rendered.includes(secret), false)
  assert.equal(rendered.includes("message="), false)
  assert.equal(copied.length, 0, "diagnostics must never copy without an explicit click")
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsCopy").props.onClick()
  await settle()
  tree = harness.flush()
  assert.equal(copied.length, 1)
  assert.equal(copied[0].includes(secret), false)
  assert.deepEqual(Object.keys(JSON.parse(copied[0])), [
    "format",
    "version",
    "mode",
    "outcome",
    "observedAt",
    "checks",
  ])
  assert.match(textContent(tree), /diagnosticsCopied/u)

  harness.unmount()
})

test("connection diagnostics can be cancelled and abort safely on unmount", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const pending = []
  const calls = []
  const client = clientModule.createConnectionDiagnosticsClient({
    rpc: {
      call(_channel, _endpoint, payload, signal) {
        const request = deferred()
        pending.push(request)
        calls.push({ payload, signal })
        return request.promise
      },
    },
  })
  harness.mount(clientModule.ConnectionDiagnosticsSettings, {
    client,
    t: (key) => key === "locale" ? "en-US" : key,
  })
  let tree = harness.tree()
  findElement(tree, (element) => element.props?.className === "dshCodexDiagnosticsToggle").props.onClick()
  tree = harness.flush()
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsAccount").props.onClick()
  tree = harness.flush()
  assert.equal(calls[0].signal.aborted, false)
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsCancel").props.onClick()
  tree = harness.flush()
  assert.equal(calls[0].signal.aborted, true)
  assert.match(textContent(tree), /diagnosticsOutcomeCancelled/u)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsLocal").props.onClick()
  harness.flush()
  assert.equal(calls.length, 2)
  harness.unmount()
  assert.equal(calls[1].signal.aborted, true)
  pending[0].resolve({ ok: false, error: { code: "cancelled", message: "ignored" } })
  pending[1].resolve({ ok: false, error: { code: "cancelled", message: "ignored" } })
  await settle()
  assert.equal(harness.updatesAfterUnmount(), 0)
})

test("real request diagnostics require a fresh second confirmation and never replay automatically", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const calls = []
  const pending = []
  const consentId = "00000000-0000-4000-8000-000000000000"
  const connection = {
    rpc: {
      call(channel, endpoint, payload, signal) {
        const request = deferred()
        calls.push({ channel, endpoint, payload, signal })
        pending.push(request)
        return request.promise
      },
    },
  }
  harness.mount(clientModule.ConnectionDiagnosticsSettings, {
    client: clientModule.createConnectionDiagnosticsClient(connection),
    t: (key) => key === "locale" ? "en-US" : key,
  })
  findElement(harness.tree(), (element) => element.props?.className === "dshCodexDiagnosticsToggle")
    .props.onClick()
  let tree = harness.flush()
  assert.equal(calls.length, 0)
  assert.match(textContent(tree), /diagnosticsNetworkHelp/u)
  assert.match(textContent(tree), /diagnosticsHistoryHelp/u)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsNetwork").props.onClick()
  tree = harness.flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, "prepare-network")
  assert.deepEqual({ ...calls[0].payload }, {})
  assert.equal(findElement(tree, (element) => textContent(element) === "diagnosticsNetworkConfirm"), undefined)

  pending[0].resolve({
    ok: true,
    value: {
      version: 1,
      consentId,
      expiresAt: 60_000,
      modelId: "gpt-fixture",
      transport: "sse",
    },
  })
  await settle()
  tree = harness.flush()
  assert.match(textContent(tree), /diagnosticsNetworkConsentHelp/u)
  assert.match(textContent(tree), /diagnosticsNetworkModel.*gpt-fixture/u)
  assert.equal(calls.length, 1, "preparing confirmation must not send a model request")
  assert.equal(findElements(tree, (element) => element.type === "button"
    && ["diagnosticsLocal", "diagnosticsAccount", "diagnosticsNetwork"].includes(textContent(element)))
    .every(({ props }) => props.disabled), true)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsNetworkConfirm").props.onClick()
  tree = harness.flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].endpoint, "run-network")
  assert.deepEqual({ ...calls[1].payload }, { consentId })
  assert.equal(textContent(findElement(tree, (element) => element.props?.["aria-busy"] === "true")), "diagnosticsNetworkRunning")

  pending[1].resolve({
    ok: true,
    value: {
      version: 2,
      mode: "network",
      outcome: "pass",
      observedAt: 1,
      checks: [{
        id: "runtime",
        status: "pass",
        code: "runtime-ready",
        facts: { route: "dsh-codex", registered: true },
      }, {
        id: "credential",
        status: "pass",
        code: "credential-ready",
        facts: { configured: true, state: "signed-in", writable: true },
      }, {
        id: "models",
        status: "pass",
        code: "models-ready",
        facts: { catalogCount: 1, enabledCount: 1, selection: "all", allEnabled: true },
      }, {
        id: "model-request",
        status: "pass",
        code: "model-request-ready",
        facts: { attempted: true, outputObserved: true, modelId: "gpt-fixture" },
      }],
    },
  })
  await settle()
  tree = harness.flush()
  assert.match(textContent(tree), /diagnosticsCheckModelRequest/u)
  assert.match(textContent(tree), /model-request-ready/u)
  assert.equal(calls.length, 2, "a completed request must never replay automatically")

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsNetwork").props.onClick()
  pending[2].resolve({
    ok: true,
    value: {
      version: 1,
      consentId: "11111111-1111-4111-8111-111111111111",
      expiresAt: 60_001,
      modelId: "gpt-fixture",
      transport: "sse",
    },
  })
  await settle()
  tree = harness.flush()
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsNetworkConsentCancel").props.onClick()
  tree = harness.flush()
  assert.equal(calls.length, 3, "cancelling local consent must not run the prepared request")
  assert.equal(findElement(tree, (element) => textContent(element) === "diagnosticsNetworkConfirm"), undefined)
  harness.unmount()
})

test("cancelling an active real diagnostic warns that usage may already be consumed", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const pending = deferred()
  let networkSignal
  const client = {
    prepareNetwork: async () => ({
      version: 1,
      consentId: "00000000-0000-4000-8000-000000000000",
      expiresAt: Date.now() + 60_000,
      modelId: "gpt-fixture",
      transport: "sse",
    }),
    runNetwork(_consentId, signal) {
      networkSignal = signal
      return pending.promise
    },
    run: async () => { throw new Error("not used") },
    history: async () => ({ version: 1, limit: 20, reports: [] }),
    clearHistory: async () => ({ cleared: 0 }),
  }
  harness.mount(clientModule.ConnectionDiagnosticsSettings, {
    client,
    t: (key) => key === "locale" ? "en-US" : key,
  })
  findElement(harness.tree(), (element) => element.props?.className === "dshCodexDiagnosticsToggle")
    .props.onClick()
  let tree = harness.flush()
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsNetwork").props.onClick()
  await settle()
  tree = harness.flush()
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsNetworkConfirm").props.onClick()
  tree = harness.flush()
  assert.equal(networkSignal.aborted, false)
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsCancel").props.onClick()
  tree = harness.flush()
  assert.equal(networkSignal.aborted, true)
  assert.match(textContent(tree), /diagnosticsNetworkCancelledAfterStart/u)
  assert.doesNotMatch(textContent(tree), /diagnosticsOutcomeCancelled/u)
  pending.resolve({
    version: 2,
    mode: "network",
    outcome: "warning",
    observedAt: 1,
    checks: [],
  })
  await settle()
  assert.equal(harness.updatesAfterUnmount(), 0)
  harness.unmount()
})

test("cancelling while preparing real-diagnostic consent never claims a request was sent", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const pending = deferred()
  let prepareSignal
  const client = {
    prepareNetwork(signal) {
      prepareSignal = signal
      return pending.promise
    },
    runNetwork: async () => { throw new Error("must not dispatch") },
    run: async () => { throw new Error("not used") },
    history: async () => ({ version: 1, limit: 20, reports: [] }),
    clearHistory: async () => ({ cleared: 0 }),
  }
  harness.mount(clientModule.ConnectionDiagnosticsSettings, {
    client,
    t: (key) => key === "locale" ? "en-US" : key,
  })
  findElement(harness.tree(), (element) => element.props?.className === "dshCodexDiagnosticsToggle")
    .props.onClick()
  let tree = harness.flush()
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsNetwork").props.onClick()
  tree = harness.flush()
  assert.equal(prepareSignal.aborted, false)
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsCancel").props.onClick()
  tree = harness.flush()
  assert.equal(prepareSignal.aborted, true)
  assert.match(textContent(tree), /diagnosticsOutcomeCancelled/u)
  assert.doesNotMatch(textContent(tree), /diagnosticsNetworkCancelledAfterStart/u)
  pending.resolve({
    version: 1,
    consentId: "00000000-0000-4000-8000-000000000000",
    expiresAt: Date.now() + 60_000,
    modelId: "gpt-fixture",
    transport: "sse",
  })
  await settle()
  assert.equal(harness.updatesAfterUnmount(), 0)
  harness.unmount()
})

test("diagnostic confirmations expose alertdialog names and move focus to and from destructive choices", async () => {
  const focused = []
  const harness = hookHarness({
    createHostNode: (element) => ({
      focus: () => focused.push(textContent(element)),
    }),
  })
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  const client = {
    prepareNetwork: async () => ({
      version: 1,
      consentId: "00000000-0000-4000-8000-000000000000",
      expiresAt: Date.now() + 60_000,
      modelId: "gpt-fixture",
      transport: "sse",
    }),
    runNetwork: async () => { throw new Error("not used") },
    run: async () => { throw new Error("not used") },
    history: async () => ({
      version: 1,
      limit: 20,
      reports: [{
        version: 2,
        mode: "local",
        outcome: "pass",
        observedAt: 1,
        checks: [],
      }],
    }),
    clearHistory: async () => ({ cleared: 1 }),
  }
  harness.mount(clientModule.ConnectionDiagnosticsSettings, {
    client,
    t: (key) => dictionaries.zh[key] ?? key,
  })
  findElement(harness.tree(), (element) => element.props?.className === "dshCodexDiagnosticsToggle")
    .props.onClick()
  let tree = harness.flush()
  const networkTrigger = findElement(tree, (element) => element.type === "button"
    && textContent(element) === dictionaries.zh.diagnosticsNetwork)
  assert.equal(networkTrigger.props["aria-haspopup"], "dialog")
  networkTrigger.props.onClick()
  await settle()
  tree = harness.flush()

  let dialog = findElement(tree, (element) => element.props?.role === "alertdialog")
  assert.ok(dialog)
  assert.equal(
    textContent(findElement(tree, (element) => element.props?.id === dialog.props["aria-labelledby"])),
    dictionaries.zh.diagnosticsNetworkConsentTitle,
  )
  assert.equal(
    textContent(findElement(tree, (element) => element.props?.id === dialog.props["aria-describedby"])),
    dictionaries.zh.diagnosticsNetworkConsentHelp,
  )
  assert.equal(focused.at(-1), dictionaries.zh.diagnosticsNetworkConfirm)
  let prevented = 0
  dialog.props.onKeyDown({
    key: "Escape",
    preventDefault: () => { prevented += 1 },
    stopPropagation: () => undefined,
  })
  tree = harness.flush()
  assert.equal(prevented, 1)
  assert.equal(findElement(tree, (element) => element.props?.role === "alertdialog"), undefined)
  assert.equal(focused.at(-1), dictionaries.zh.diagnosticsNetwork)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === dictionaries.zh.diagnosticsHistoryLoad).props.onClick()
  await settle()
  tree = harness.flush()
  assert.match(textContent(tree), /本机/u)
  assert.doesNotMatch(textContent(tree), /local\s*·/u)
  const clearTrigger = findElement(tree, (element) => element.type === "button"
    && textContent(element) === dictionaries.zh.diagnosticsHistoryClear)
  assert.equal(clearTrigger.props["aria-haspopup"], "dialog")
  clearTrigger.props.onClick()
  tree = harness.flush()
  dialog = findElement(tree, (element) => element.props?.role === "alertdialog")
  assert.ok(dialog)
  assert.equal(
    textContent(findElement(tree, (element) => element.props?.id === dialog.props["aria-labelledby"])),
    dictionaries.zh.diagnosticsHistoryClearConfirmTitle,
  )
  assert.equal(
    textContent(findElement(tree, (element) => element.props?.id === dialog.props["aria-describedby"])),
    dictionaries.zh.diagnosticsHistoryClearConfirmHelp,
  )
  assert.equal(focused.at(-1), dictionaries.zh.diagnosticsHistoryClearConfirm)
  dialog.props.onKeyDown({
    key: "Escape",
    preventDefault: () => { prevented += 1 },
    stopPropagation: () => undefined,
  })
  tree = harness.flush()
  assert.equal(prevented, 2)
  assert.equal(findElement(tree, (element) => element.props?.role === "alertdialog"), undefined)
  assert.equal(focused.at(-1), dictionaries.zh.diagnosticsHistoryClear)
  harness.unmount()
})

test("diagnostic history loads explicitly, exports only validated JSON, revokes its URL, and clears after confirmation", async () => {
  const harness = hookHarness()
  const blobs = []
  const urls = []
  const revoked = []
  const anchors = []
  class ExportBlob {
    constructor(parts, options) {
      this.parts = parts
      this.options = options
      blobs.push(this)
    }
  }
  const objectUrl = {
    createObjectURL(blob) {
      assert.equal(blob, blobs.at(-1))
      const value = `blob:diagnostics-${urls.length + 1}`
      urls.push(value)
      return value
    },
    revokeObjectURL(value) {
      revoked.push(value)
    },
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, "a")
      const anchor = {
        href: "",
        download: "",
        rel: "",
        clicks: 0,
        click() {
          this.clicks += 1
        },
      }
      anchors.push(anchor)
      return anchor
    },
  }
  const clientModule = await loadClientModule(harness.React, {}, {
    globals: { Blob: ExportBlob, URL: objectUrl, document },
  })
  const calls = []
  const pending = []
  const secret = "diagnostic-history-secret"
  const connection = {
    rpc: {
      call(channel, endpoint, payload, signal) {
        const request = deferred()
        calls.push({ channel, endpoint, payload, signal })
        pending.push(request)
        return request.promise
      },
    },
  }
  harness.mount(clientModule.ConnectionDiagnosticsSettings, {
    client: clientModule.createConnectionDiagnosticsClient(connection),
    t: (key) => key === "locale" ? "en-US" : key,
  })
  findElement(harness.tree(), (element) => element.props?.className === "dshCodexDiagnosticsToggle")
    .props.onClick()
  let tree = harness.flush()
  assert.equal(calls.length, 0, "mounting and expanding must not read diagnostic history")
  assert.equal(findElement(tree, (element) => textContent(element) === "diagnosticsHistoryExport"), undefined)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsHistoryLoad").props.onClick()
  tree = harness.flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, "history")
  assert.deepEqual({ ...calls[0].payload }, {})
  assert.match(textContent(tree), /diagnosticsHistoryLoading/u)
  pending[0].resolve({
    ok: true,
    value: {
      version: 1,
      limit: 20,
      reports: [{
        version: 2,
        mode: "local",
        outcome: "pass",
        observedAt: 1,
        rawError: secret,
        checks: [{
          id: "runtime",
          status: "pass",
          code: "runtime-ready",
          facts: { route: "dsh-codex", registered: true },
          message: secret,
        }, {
          id: "credential",
          status: "pass",
          code: "credential-ready",
          facts: { configured: true, state: "signed-in", writable: true },
        }, {
          id: "models",
          status: "pass",
          code: "models-ready",
          facts: { catalogCount: 1, enabledCount: 1, selection: "all", allEnabled: true },
        }],
      }],
    },
  })
  await settle()
  tree = harness.flush()
  assert.match(textContent(tree), /runtime-ready/u)
  assert.equal(textContent(tree).includes(secret), false)
  assert.equal(calls.length, 1)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsHistoryExport").props.onClick()
  tree = harness.flush()
  assert.equal(blobs.length, 1)
  assert.equal(blobs[0].options.type, "application/json;charset=utf-8")
  assert.equal(anchors.length, 1)
  assert.equal(anchors[0].clicks, 1)
  assert.equal(anchors[0].download, "dsh-codex-diagnostics-history.json")
  assert.deepEqual(revoked, urls)
  const exported = blobs[0].parts.join("")
  assert.equal(exported.includes(secret), false)
  assert.equal(JSON.parse(exported).format, "dsh-codex-diagnostics-history")
  assert.match(textContent(tree), /diagnosticsHistoryExported/u)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsHistoryClear").props.onClick()
  tree = harness.flush()
  assert.equal(calls.length, 1, "the first clear click must only reveal confirmation")
  assert.match(textContent(tree), /diagnosticsHistoryClearConfirm/u)
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "diagnosticsHistoryClearConfirm").props.onClick()
  tree = harness.flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].endpoint, "clear-history")
  assert.deepEqual({ ...calls[1].payload }, {})
  assert.match(textContent(tree), /diagnosticsHistoryClearing/u)
  pending[1].resolve({ ok: true, value: { cleared: 1 } })
  await settle()
  tree = harness.flush()
  assert.match(textContent(tree), /diagnosticsHistoryEmpty/u)
  assert.match(textContent(tree), /diagnosticsHistoryCleared/u)
  harness.unmount()
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
  await client.usage(signal)

  assert.ok(calls.every((call) => call.channel === "/dsh-codex"))
  assert.deepEqual(calls.map((call) => call.endpoint), [
    "status",
    "status",
    "start",
    "respond",
    "respond",
    "cancel",
    "logout",
    "usage",
  ])
  assert.equal(Object.keys(calls.at(-1).payload).length, 0)
})

test("connection diagnostics client uses a strict, sanitized loopback contract", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const calls = []
  const secret = "raw secret must not cross the client boundary"
  const consentId = "00000000-0000-4000-8000-000000000000"
  const checksFor = (mode) => [
    {
      id: "runtime",
      status: "pass",
      code: "runtime-ready",
      facts: { route: "dsh-codex", registered: true },
      message: secret,
    },
    {
      id: "credential",
      status: "pass",
      code: "credential-ready",
      facts: { configured: true, state: "signed-in", writable: true },
    },
    {
      id: "models",
      status: "pass",
      code: "models-ready",
      facts: { catalogCount: 7, enabledCount: 7, selection: "all", allEnabled: true },
    },
    ...(mode === "account" ? [{
      id: "account-usage",
      status: "pass",
      code: "account-usage-ready",
      facts: { rateLimitCount: 1, primaryWindows: 1, secondaryWindows: 1 },
    }] : []),
    ...(mode === "network" ? [{
      id: "model-request",
      status: "pass",
      code: "model-request-ready",
      facts: { attempted: true, outputObserved: true, modelId: "gpt-fixture" },
      response: secret,
    }] : []),
  ]
  const reportFor = (mode, observedAt = 0) => ({
    version: 2,
    mode,
    outcome: "pass",
    observedAt,
    rawError: secret,
    checks: checksFor(mode),
  })
  const connection = {
    rpc: {
      async call(channel, endpoint, payload, signal) {
        calls.push({ channel, endpoint, payload, signal })
        if (endpoint === "prepare-network") {
          return {
            ok: true,
            value: {
              version: 1,
              consentId,
              expiresAt: 60_000,
              modelId: "gpt-fixture",
              transport: "sse",
            },
          }
        }
        if (endpoint === "run-network") return { ok: true, value: reportFor("network", 1) }
        if (endpoint === "history") {
          return {
            ok: true,
            value: { version: 1, limit: 20, reports: [reportFor("local"), reportFor("network", 1)] },
          }
        }
        if (endpoint === "clear-history") return { ok: true, value: { cleared: 2 } }
        return {
          ok: true,
          value: reportFor(payload.mode),
        }
      },
    },
  }
  const client = clientModule.createConnectionDiagnosticsClient(connection)
  const signal = new AbortController().signal

  const local = plain(await client.run("local", signal))
  const account = plain(await client.run("account", signal))

  assert.deepEqual(local, {
    version: 2,
    mode: "local",
    outcome: "pass",
    observedAt: 0,
    checks: [{
      id: "runtime",
      status: "pass",
      code: "runtime-ready",
      facts: { route: "dsh-codex", registered: true },
    }, {
      id: "credential",
      status: "pass",
      code: "credential-ready",
      facts: { configured: true, state: "signed-in", writable: true },
    }, {
      id: "models",
      status: "pass",
      code: "models-ready",
      facts: { catalogCount: 7, enabledCount: 7, selection: "all", allEnabled: true },
    }],
  })
  assert.equal(JSON.stringify(local).includes(secret), false)
  assert.equal(account.mode, "account")
  assert.deepEqual(calls.map(({ channel }) => channel), [
    "/dsh-codex-diagnostics",
    "/dsh-codex-diagnostics",
  ])
  assert.deepEqual(calls.map(({ endpoint }) => endpoint), ["run", "run"])
  assert.deepEqual(calls.map(({ payload }) => ({ ...payload })), [
    { mode: "local" },
    { mode: "account" },
  ])
  assert.equal(calls[0].signal, signal)
  await assert.rejects(
    () => client.run("active"),
    (error) => error.name === "TypeError" && error.message === "Unsupported diagnostics mode.",
  )
  assert.equal(calls.length, 2, "an unsupported mode must not reach RPC")

  const consent = plain(await client.prepareNetwork(signal))
  assert.deepEqual(consent, {
    version: 1,
    consentId,
    expiresAt: 60_000,
    modelId: "gpt-fixture",
    transport: "sse",
  })
  const network = plain(await client.runNetwork(consentId, signal))
  assert.equal(network.mode, "network")
  assert.equal(network.checks.at(-1).code, "model-request-ready")
  assert.equal(JSON.stringify(network).includes(secret), false)
  const history = plain(await client.history(signal))
  assert.equal(history.version, 1)
  assert.equal(history.limit, 20)
  assert.deepEqual(history.reports.map(({ mode }) => mode), ["local", "network"])
  assert.equal(JSON.stringify(history).includes(secret), false)
  assert.deepEqual(plain(await client.clearHistory(signal)), { cleared: 2 })
  assert.deepEqual(calls.slice(2).map(({ endpoint }) => endpoint), [
    "prepare-network",
    "run-network",
    "history",
    "clear-history",
  ])
  assert.deepEqual(calls.slice(2).map(({ payload }) => ({ ...payload })), [
    {},
    { consentId },
    {},
    {},
  ])
  assert.ok(calls.slice(2).every(({ signal: value }) => value === signal))
  assert.equal(JSON.parse(clientModule.diagnosticsHistoryText(history)).format, "dsh-codex-diagnostics-history")
  await assert.rejects(
    () => client.runNetwork("not-a-consent"),
    (error) => error.name === "TypeError" && error.message === "Invalid diagnostics consent ID.",
  )
  assert.equal(calls.length, 6, "an invalid consent ID must not reach RPC")

  const invalidReports = [
    { label: "empty", checks: [] },
    { label: "duplicate", checks: [checksFor("local")[0], checksFor("local")[0], checksFor("local")[2]] },
    { label: "unknown", checks: [checksFor("local")[0], checksFor("local")[1], { ...checksFor("local")[2], id: "network" }] },
    { label: "out of order", checks: [checksFor("local")[1], checksFor("local")[0], checksFor("local")[2]] },
    {
      label: "unknown code",
      checks: [{ ...checksFor("local")[0], code: "runtime-mystery" }, ...checksFor("local").slice(1)],
    },
    {
      label: "code and status conflict",
      outcome: "warning",
      checks: [{ ...checksFor("local")[0], status: "warning" }, ...checksFor("local").slice(1)],
    },
    { label: "outcome mismatch", outcome: "warning", checks: checksFor("local") },
    {
      label: "missing required facts",
      checks: [{ ...checksFor("local")[0], facts: undefined }, ...checksFor("local").slice(1)],
    },
    {
      label: "extra fact",
      checks: [{ ...checksFor("local")[0], facts: { route: "dsh-codex", registered: true, message: secret } }, ...checksFor("local").slice(1)],
    },
    {
      label: "facts forbidden for code",
      outcome: "fail",
      checks: [{
        ...checksFor("local")[0],
        status: "fail",
        code: "runtime-unavailable",
        facts: { route: "dsh-codex", registered: true },
      }, ...checksFor("local").slice(1)],
    },
    {
      label: "facts forbidden when cancelled",
      outcome: "cancelled",
      checks: [
        { id: "runtime", status: "skipped", code: "cancelled", facts: { route: "dsh-codex", registered: true } },
        { id: "credential", status: "skipped", code: "cancelled" },
        { id: "models", status: "skipped", code: "cancelled" },
      ],
    },
  ]
  for (const invalidReport of invalidReports) {
    const invalid = clientModule.createConnectionDiagnosticsClient({
      rpc: {
        call: async () => ({
          ok: true,
          value: {
            version: 2,
            mode: "local",
            outcome: invalidReport.outcome ?? "pass",
            observedAt: 1,
            checks: invalidReport.checks,
          },
        }),
      },
    })
    await assert.rejects(
      () => invalid.run("local"),
      (error) => error.code === "INVALID_DIAGNOSTICS_RESPONSE"
        && !error.message.includes(secret),
      invalidReport.label,
    )
  }

  const failed = clientModule.createConnectionDiagnosticsClient({
    rpc: { call: async () => ({ ok: false, error: { code: "account-http-error", message: secret } }) },
  })
  await assert.rejects(
    () => failed.run("account"),
    (error) => error.code === "account-http-error" && !error.message.includes(secret),
  )

  for (const code of [
    "account-http-auth-error",
    "account-http-rate-limited",
    "account-http-server-error",
  ]) {
    const classified = clientModule.createConnectionDiagnosticsClient({
      rpc: {
        call: async () => ({
          ok: true,
          value: {
            version: 2,
            mode: "account",
            outcome: "fail",
            observedAt: 2,
            checks: [
              ...checksFor("local"),
              { id: "account-usage", status: "fail", code },
            ],
          },
        }),
      },
    })
    assert.equal((await classified.run("account")).checks.at(-1).code, code)
  }
})

test("network diagnostics distinguish an internal preflight deadline from user cancellation", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const report = {
    version: 2,
    mode: "network",
    outcome: "fail",
    observedAt: 0,
    checks: [{
      id: "runtime",
      status: "pass",
      code: "runtime-ready",
      facts: { route: "dsh-codex", registered: true },
    }, {
      id: "credential",
      status: "fail",
      code: "preflight-timeout",
    }, {
      id: "models",
      status: "skipped",
      code: "preflight-not-run",
    }, {
      id: "model-request",
      status: "skipped",
      code: "preflight-not-run",
    }],
  }
  const client = clientModule.createConnectionDiagnosticsClient({
    rpc: { call: async () => ({ ok: true, value: report }) },
  })

  assert.deepEqual(plain(await client.runNetwork(
    "00000000-0000-4000-8000-000000000000",
  )), report)
})

test("real request diagnostics accept only fixed model-request codes and attempted facts", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const consentId = "00000000-0000-4000-8000-000000000000"
  const prerequisites = [{
    id: "runtime",
    status: "pass",
    code: "runtime-ready",
    facts: { route: "dsh-codex", registered: true },
  }, {
    id: "credential",
    status: "pass",
    code: "credential-ready",
    facts: { configured: true, state: "signed-in", writable: true },
  }, {
    id: "models",
    status: "pass",
    code: "models-ready",
    facts: { catalogCount: 1, enabledCount: 1, selection: "all", allEnabled: true },
  }]
  const cases = [
    ["model-request-ready", "pass", "pass", true],
    ["model-request-max-tokens", "warning", "warning", true],
    ["model-request-tool-call", "warning", "warning", true],
    ["model-response-empty", "warning", "warning", true],
    ["model-request-auth-error", "fail", "fail", true],
    ["model-request-quota-exhausted", "fail", "fail", true],
    ["model-request-rate-limited", "fail", "fail", true],
    ["model-request-timeout", "fail", "fail", true],
    ["model-request-server-error", "fail", "fail", true],
    ["model-request-transport-error", "fail", "fail", true],
    ["model-request-unsupported", "fail", "fail", true],
    ["model-request-invalid", "fail", "fail", true],
    ["model-request-provider-error", "fail", "fail", true],
    ["model-request-unknown-model", "fail", "fail", true],
    ["model-request-credential-missing", "fail", "fail", true],
    ["model-request-aborted", "fail", "fail", true],
    ["model-request-cancelled-after-attempt", "warning", "warning", true],
    ["model-request-failed", "fail", "fail", true],
    ["model-request-prerequisite-failed", "fail", "fail", false],
    ["model-request-unavailable", "fail", "fail", false],
    ["model-request-busy", "fail", "fail", false],
    ["cancelled", "skipped", "cancelled", false],
  ]
  for (const [code, status, outcome, hasFacts] of cases) {
    const client = clientModule.createConnectionDiagnosticsClient({
      rpc: {
        call: async () => ({
          ok: true,
          value: {
            version: 2,
            mode: "network",
            outcome,
            observedAt: 0,
            checks: [
              ...prerequisites,
              {
                id: "model-request",
                status,
                code,
                ...(hasFacts ? {
                  facts: { attempted: true, outputObserved: false, modelId: "gpt-fixture" },
                } : {}),
              },
            ],
          },
        }),
      },
    })
    assert.equal((await client.runNetwork(consentId)).checks.at(-1).code, code)
  }

  const invalidChecks = [{
    id: "model-request",
    status: "fail",
    code: "model-request-mystery",
  }, {
    id: "model-request",
    status: "fail",
    code: "model-request-busy",
    facts: { attempted: true, outputObserved: false, modelId: "gpt-fixture" },
  }, {
    id: "model-request",
    status: "fail",
    code: "model-request-prerequisite-failed",
    facts: { attempted: true, outputObserved: false, modelId: "gpt-fixture" },
  }, {
    id: "model-request",
    status: "fail",
    code: "model-request-failed",
    facts: { attempted: false, outputObserved: false, modelId: "gpt-fixture" },
  }, {
    id: "model-request",
    status: "fail",
    code: "model-request-failed",
    facts: { attempted: true, outputObserved: false, modelId: "unsafe model id" },
  }]
  for (const modelRequest of invalidChecks) {
    const invalid = clientModule.createConnectionDiagnosticsClient({
      rpc: {
        call: async () => ({
          ok: true,
          value: {
            version: 2,
            mode: "network",
            outcome: "fail",
            observedAt: 0,
            checks: [...prerequisites, modelRequest],
          },
        }),
      },
    })
    await assert.rejects(
      () => invalid.runNetwork(consentId),
      (error) => error.code === "INVALID_DIAGNOSTICS_RESPONSE",
      modelRequest.code,
    )
  }
})

test("network consent and diagnostic history envelopes are strictly bounded and errors stay sanitized", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const consentId = "00000000-0000-4000-8000-000000000000"
  const secret = "raw-consent-error"
  const validConsent = {
    version: 1,
    consentId,
    expiresAt: 60_000,
    modelId: "gpt-fixture",
    transport: "sse",
  }
  for (const value of [
    { ...validConsent, modelId: `gpt-fixture\n${secret}` },
    { ...validConsent, modelId: "g".repeat(257) },
    { ...validConsent, transport: "websocket" },
    { ...validConsent, expiresAt: -1 },
    { ...validConsent, consentId: "not-a-uuid" },
    { ...validConsent, extra: secret },
  ]) {
    const invalid = clientModule.createConnectionDiagnosticsClient({
      rpc: { call: async () => ({ ok: true, value }) },
    })
    await assert.rejects(
      () => invalid.prepareNetwork(),
      (error) => error.code === "INVALID_DIAGNOSTICS_RESPONSE" && !error.message.includes(secret),
    )
  }

  const emptyHistory = { version: 1, limit: 50, reports: [] }
  for (const value of [
    { ...emptyHistory, limit: 0 },
    { ...emptyHistory, limit: 51 },
    { ...emptyHistory, reports: Array.from({ length: 51 }, () => null) },
    { ...emptyHistory, extra: secret },
  ]) {
    const invalid = clientModule.createConnectionDiagnosticsClient({
      rpc: { call: async () => ({ ok: true, value }) },
    })
    await assert.rejects(
      () => invalid.history(),
      (error) => error.code === "INVALID_DIAGNOSTICS_RESPONSE" && !error.message.includes(secret),
    )
  }

  for (const value of [{ cleared: -1 }, { cleared: 51 }, { cleared: 1, extra: secret }]) {
    const invalid = clientModule.createConnectionDiagnosticsClient({
      rpc: { call: async () => ({ ok: true, value }) },
    })
    await assert.rejects(
      () => invalid.clearHistory(),
      (error) => error.code === "INVALID_DIAGNOSTICS_RESPONSE" && !error.message.includes(secret),
    )
  }

  const expired = clientModule.createConnectionDiagnosticsClient({
    rpc: {
      call: async () => ({
        ok: false,
        error: { code: "consent-invalid", message: secret },
      }),
    },
  })
  await assert.rejects(
    () => expired.runNetwork(consentId),
    (error) => error.code === "consent-invalid"
      && error.message === "Connection diagnostics failed."
      && !error.message.includes(secret),
  )
})

test("browser session preference client uses the dedicated loopback contract", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const calls = []
  const connection = {
    rpc: {
      async call(channel, endpoint, payload, signal) {
        calls.push({ channel, endpoint, payload, signal })
        return {
          ok: true,
          value: {
            fast: endpoint === "set-fast" ? payload.fast : false,
            transport: endpoint === "set-transport" ? payload.transport : "auto",
            textVerbosity: endpoint === "set-text-verbosity" ? payload.textVerbosity : "low",
            reasoningSummary: endpoint === "set-reasoning-summary" ? payload.reasoningSummary : "auto",
            ...(payload.modelId === undefined ? {} : { fastSupported: true }),
          },
        }
      },
    },
  }
  const client = clientModule.createSessionPreferenceClient(connection).forSession("session-a")
  const signal = new AbortController().signal

  assert.deepEqual({ ...(await client.get(signal)) }, {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.deepEqual({ ...(await client.getForModel("gpt-5.6-sol", signal)) }, {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
    fastSupported: true,
  })
  assert.deepEqual({ ...(await client.setFast(true, signal)) }, {
    fast: true,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.deepEqual({ ...(await client.setTransport("websocket", signal)) }, {
    fast: false,
    transport: "websocket",
    textVerbosity: "low",
    reasoningSummary: "auto",
  })
  assert.deepEqual({ ...(await client.setTextVerbosity("high", signal)) }, {
    fast: false,
    transport: "auto",
    textVerbosity: "high",
    reasoningSummary: "auto",
  })
  assert.deepEqual({ ...(await client.setReasoningSummary("concise", signal)) }, {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "concise",
  })
  assert.deepEqual(calls.map(({ channel }) => channel), [
    "/dsh-codex-session",
    "/dsh-codex-session",
    "/dsh-codex-session",
    "/dsh-codex-session",
    "/dsh-codex-session",
    "/dsh-codex-session",
  ])
  assert.deepEqual(calls.map(({ endpoint }) => endpoint), [
    "get",
    "get",
    "set-fast",
    "set-transport",
    "set-text-verbosity",
    "set-reasoning-summary",
  ])
  assert.deepEqual(calls.map(({ payload }) => ({ ...payload })), [
    { sessionId: "session-a" },
    { sessionId: "session-a", modelId: "gpt-5.6-sol" },
    { sessionId: "session-a", fast: true },
    { sessionId: "session-a", transport: "websocket" },
    { sessionId: "session-a", textVerbosity: "high" },
    { sessionId: "session-a", reasoningSummary: "concise" },
  ])
})

test("Fast lightning appears immediately for supported Codex models and toggles 1.5x per session", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const calls = []
  const preferenceClient = {
    async getForModel() {
      calls.push(["get"])
      return { fast: false, transport: "auto", fastSupported: true }
    },
    async setFast(fast) {
      calls.push(["set-fast", fast])
      return { fast }
    },
  }
  const t = (key) => key
  const useModelDirectory = (select) => select({
    current: { provider: "dsh-codex", model: "gpt-5.6-sol" },
  })

  harness.mount(clientModule.CodexFastToggle, {
    sessionId: "session-fast",
    session: { removed: false },
    input: { phase: "idle" },
    useModelDirectory,
    preferenceClient,
    t,
  })
  await settle()
  harness.flush()

  let button = findElement(
    harness.tree(),
    (element) => element.type === "button" && element.props.className?.includes("dshCodexFastToggle"),
  )
  assert.ok(button)
  assert.equal(button.props["aria-pressed"], false)
  assert.equal(button.props["aria-label"], "fastEnable")
  assert.equal(button.props.disabled, false)
  assert.equal(findElements(button, (element) => element.type === "svg").length, 1)

  button.props.onClick()
  harness.flush()
  button = findElement(harness.tree(), (element) => element.type === "button")
  assert.equal(button.props.disabled, true)
  await settle()
  harness.flush()
  button = findElement(harness.tree(), (element) => element.type === "button")
  assert.equal(button.props["aria-pressed"], true)
  assert.equal(button.props["aria-label"], "fastDisable")
  assert.equal(button.props["data-fast"], "true")
  assert.deepEqual(calls, [["get"], ["set-fast", true]])

  button.props.onClick()
  await settle()
  harness.flush()
  button = findElement(harness.tree(), (element) => element.type === "button")
  assert.equal(button.props["aria-pressed"], false)
  assert.deepEqual(calls.at(-1), ["set-fast", false])
  harness.unmount()
})

test("transport selector changes and resets the current session with keyboard and ARIA semantics", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const calls = []
  const preferenceClient = {
    async getForModel() {
      calls.push(["get"])
      return { fast: false, transport: "auto", fastSupported: true }
    },
    async setFast(fast) {
      return { fast, transport: "auto" }
    },
    async setTransport(transport) {
      calls.push(["set-transport", transport])
      return { fast: false, transport }
    },
  }
  const translations = {
    transportLabel: "传输方式：{transport}",
    transportMenu: "当前会话的传输方式",
    requestSettings: "Codex 请求设置",
    transportAuto: "自动",
    transportAutoHelp: "自动选择",
    transportSse: "SSE",
    transportSseHelp: "SSE 响应",
    transportWebsocket: "WebSocket",
    transportWebsocketHelp: "实时连接",
    transportWebsocketCached: "WebSocket 缓存",
    transportWebsocketCachedHelp: "复用缓存",
    transportSessionOnly: "仅应用于当前会话",
    transportReset: "恢复自动",
    transportResetLabel: "将当前会话的传输方式恢复为自动",
  }
  const t = (key) => translations[key] ?? key
  const useModelDirectory = (select) => select({
    current: { provider: "dsh-codex", model: "gpt-5.6-sol" },
  })

  harness.mount(clientModule.CodexFastToggle, {
    session: { removed: false },
    useModelDirectory,
    preferenceClient,
    t,
  })
  await settle()
  harness.flush()

  let toggle = findElement(
    harness.tree(),
    (element) => element.type === "button"
      && element.props.className?.includes("dshCodexTransportToggle"),
  )
  assert.ok(toggle)
  assert.equal(toggle.props["data-transport"], "auto")
  assert.equal(toggle.props["aria-label"], "传输方式：自动")
  assert.equal(toggle.props["aria-haspopup"], "dialog")
  assert.equal(toggle.props["aria-expanded"], "false")

  let prevented = false
  toggle.props.onKeyDown({
    key: "ArrowDown",
    preventDefault() { prevented = true },
  })
  harness.flush()
  assert.equal(prevented, true)

  let menu = findElement(harness.tree(), (element) => element.props?.role === "dialog")
  assert.ok(menu)
  assert.match(menu.props.id, /^dsh-codex-transport-menu-test-/u)
  toggle = findElement(
    harness.tree(),
    (element) => element.type === "button"
      && element.props.className?.includes("dshCodexTransportToggle"),
  )
  assert.equal(toggle.props["aria-controls"], menu.props.id)
  assert.equal(menu.props["aria-label"], "Codex 请求设置")
  assert.equal(findElements(menu, (element) => element.type === "select").length, 2)
  let options = findElements(menu, (element) => element.props?.role === "radio")
  assert.equal(options.length, 4)
  assert.equal(options[0].props["aria-checked"], true)
  assert.equal(options[0].props.tabIndex, 0)
  let focusCalls = 0
  toggle.props.ref.current = { focus: () => { focusCalls += 1 } }

  menu.props.onKeyDown({ key: "ArrowDown", preventDefault() {} })
  harness.flush()
  menu = findElement(harness.tree(), (element) => element.props?.role === "dialog")
  options = findElements(menu, (element) => element.props?.role === "radio")
  assert.equal(options[1].props.tabIndex, 0)
  options[1].props.onClick()
  await settle()
  harness.flush()

  toggle = findElement(
    harness.tree(),
    (element) => element.type === "button"
      && element.props.className?.includes("dshCodexTransportToggle"),
  )
  assert.equal(toggle.props["data-transport"], "sse")
  assert.equal(toggle.props["aria-label"], "传输方式：SSE")
  assert.equal(focusCalls, 1, "choosing a transport must return focus to its trigger")
  assert.deepEqual(calls, [["get"], ["get"], ["set-transport", "sse"]])

  toggle.props.onClick()
  harness.flush()
  menu = findElement(harness.tree(), (element) => element.props?.role === "dialog")
  const reset = findElement(
    menu,
    (element) => element.type === "button"
      && element.props.className?.includes("dshCodexTransportReset"),
  )
  assert.ok(reset)
  assert.equal(reset.props.disabled, false)
  assert.match(textContent(reset), /恢复自动/u)
  reset.props.onClick()
  await settle()
  harness.flush()
  assert.deepEqual(calls.at(-1), ["set-transport", "auto"])

  toggle = findElement(
    harness.tree(),
    (element) => element.type === "button"
      && element.props.className?.includes("dshCodexTransportToggle"),
  )
  toggle.props.onClick()
  harness.flush()
  menu = findElement(harness.tree(), (element) => element.props?.role === "dialog")
  prevented = false
  menu.props.onKeyDown({
    key: "Escape",
    preventDefault() { prevented = true },
  })
  harness.flush()
  assert.equal(prevented, true)
  assert.equal(findElement(harness.tree(), (element) => element.props?.role === "dialog"), undefined)
  harness.unmount()
})

test("Codex request settings update reply detail and reasoning summary and show safe transport health", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const calls = []
  let preference = {
    fast: false,
    transport: "websocket-cached",
    textVerbosity: "low",
    reasoningSummary: "auto",
    fastSupported: true,
    transportHealth: {
      status: "observed",
      requests: 4,
      connectionsCreated: 2,
      connectionsReused: 2,
      cachedContextRequests: 3,
      fullContextRequests: 2,
      deltaRequests: 1,
      websocketFailures: 1,
      sseFallbacks: 1,
      websocketFallbackActive: true,
    },
  }
  const preferenceClient = {
    async getForModel() {
      calls.push(["get"])
      return preference
    },
    async setFast() {
      assert.fail("not used")
    },
    async setTransport() {
      assert.fail("not used")
    },
    async setTextVerbosity(textVerbosity) {
      calls.push(["set-text-verbosity", textVerbosity])
      preference = { ...preference, textVerbosity }
      return preference
    },
    async setReasoningSummary(reasoningSummary) {
      calls.push(["set-reasoning-summary", reasoningSummary])
      preference = { ...preference, reasoningSummary }
      return preference
    },
  }
  const useModelDirectory = (select) => select({
    current: { provider: "dsh-codex", model: "gpt-5.6-sol" },
  })
  harness.mount(clientModule.CodexFastToggle, {
    session: { removed: false },
    useModelDirectory,
    preferenceClient,
    t: (key) => key,
  })
  await settle()
  let tree = harness.flush()
  findElement(tree, (element) => element.props.className === "dshCodexTransportToggle")
    .props.onClick()
  await settle()
  tree = harness.flush()

  let selects = findElements(tree, (element) => element.type === "select")
  assert.deepEqual(selects.map(({ props }) => props.value), ["low", "auto"])
  const healthText = textContent(findElement(
    tree,
    (element) => element.props.className === "dshCodexTransportHealth",
  ))
  assert.match(healthText, /transportHealthRequests 4/u)
  assert.match(healthText, /transportHealthReused 2/u)
  assert.match(healthText, /transportHealthFallbackActive/u)
  assert.doesNotMatch(healthText, /PreviousResponse|WebSocketError|raw/iu)

  let escaped = false
  findElement(tree, (element) => element.props.role === "dialog").props.onKeyDown({
    key: "Escape",
    target: { tagName: "SELECT" },
    preventDefault() { escaped = true },
  })
  tree = harness.flush()
  assert.equal(escaped, true)
  assert.equal(findElement(tree, (element) => element.props.role === "dialog"), undefined)
  findElement(tree, (element) => element.props.className === "dshCodexTransportToggle")
    .props.onClick()
  await settle()
  tree = harness.flush()
  selects = findElements(tree, (element) => element.type === "select")

  selects[0].props.onChange({ currentTarget: { value: "high" } })
  await settle()
  tree = harness.flush()
  selects = findElements(tree, (element) => element.type === "select")
  assert.equal(selects[0].props.value, "high")
  selects[1].props.onChange({ currentTarget: { value: "concise" } })
  await settle()
  tree = harness.flush()
  selects = findElements(tree, (element) => element.type === "select")
  assert.equal(selects[1].props.value, "concise")
  assert.deepEqual(calls, [
    ["get"],
    ["get"],
    ["get"],
    ["set-text-verbosity", "high"],
    ["set-reasoning-summary", "concise"],
  ])
  harness.unmount()
})

test("reset-to-auto clears a latched SSE fallback even when Auto is already selected", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const calls = []
  const observedHealth = {
    status: "observed",
    requests: 1,
    connectionsCreated: 1,
    connectionsReused: 0,
    cachedContextRequests: 0,
    fullContextRequests: 1,
    deltaRequests: 0,
    websocketFailures: 1,
    sseFallbacks: 1,
    websocketFallbackActive: true,
  }
  const preferenceClient = {
    getForModel: async () => ({
      fast: false,
      transport: "auto",
      textVerbosity: "low",
      reasoningSummary: "auto",
      fastSupported: true,
      transportHealth: observedHealth,
    }),
    setFast: async () => assert.fail("not used"),
    async setTransport(transport) {
      calls.push(transport)
      return {
        fast: false,
        transport,
        textVerbosity: "low",
        reasoningSummary: "auto",
        transportHealth: { status: "idle" },
      }
    },
  }
  harness.mount(clientModule.CodexFastToggle, {
    session: { removed: false },
    useModelDirectory: (select) => select({
      current: { provider: "dsh-codex", model: "gpt-5.6-sol" },
    }),
    preferenceClient,
    t: (key) => key,
  })
  await settle()
  let tree = harness.flush()
  findElement(tree, (element) => element.props.className === "dshCodexTransportToggle")
    .props.onClick()
  await settle()
  tree = harness.flush()

  const reset = findElement(
    tree,
    (element) => element.props.className === "dshCodexTransportReset",
  )
  assert.equal(reset.props.disabled, false)
  reset.props.onClick()
  await settle()
  tree = harness.flush()

  assert.deepEqual(calls, ["auto"])
  assert.equal(findElement(tree, (element) => element.props.role === "dialog"), undefined)
  harness.unmount()
})

test("Fast and transport controls retry a failed read and transport dismisses outside", async () => {
  const harness = hookHarness()
  let pointerdown
  const document = {
    addEventListener(type, listener) {
      if (type === "pointerdown") pointerdown = listener
    },
    removeEventListener(type, listener) {
      if (type === "pointerdown" && pointerdown === listener) pointerdown = undefined
    },
  }
  const clientModule = await loadClientModule(harness.React, {}, { document })
  let reads = 0
  const preferenceClient = {
    async getForModel() {
      reads += 1
      if (reads === 1) throw new Error("temporary read failure")
      return { fast: false, transport: "auto", fastSupported: true }
    },
    async setFast(fast) {
      return { fast, transport: "auto" }
    },
    async setTransport(transport) {
      return { fast: false, transport }
    },
  }
  harness.mount(clientModule.CodexFastToggle, {
    session: { removed: false },
    useModelDirectory: (select) => select({
      current: { provider: "dsh-codex", model: "gpt-5.6-sol" },
    }),
    preferenceClient,
    t: (key) => key,
  })
  await settle()
  harness.flush()

  let fastButton = findElement(
    harness.tree(),
    (element) => element.type === "button"
      && element.props.className?.includes("dshCodexFastToggle"),
  )
  assert.equal(fastButton.props["aria-label"], "fastUnavailable")
  assert.equal(fastButton.props.disabled, false)
  fastButton.props.onClick()
  await settle()
  harness.flush()
  assert.equal(reads, 2, "Fast must retry when the first capability read failed")

  let toggle = findElement(
    harness.tree(),
    (element) => element.type === "button"
      && element.props.className?.includes("dshCodexTransportToggle"),
  )
  assert.equal(toggle.props["aria-label"], "transportLabel")
  assert.equal(toggle.props.disabled, false)
  toggle.props.onClick()
  harness.flush()
  assert.equal(typeof pointerdown, "function")
  assert.ok(findElement(harness.tree(), (element) => element.props?.role === "dialog"))
  pointerdown({ target: {} })
  harness.flush()
  assert.equal(findElement(harness.tree(), (element) => element.props?.role === "dialog"), undefined)
  harness.unmount()
})

test("Fast lightning is hidden outside Codex and disabled for unsupported Codex models", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const queriedModels = []
  const props = {
    sessionId: "session-fast",
    session: { removed: false },
    input: { phase: "idle" },
    preferenceClient: {
      async getForModel(modelId) {
        queriedModels.push(modelId)
        return {
          fast: false,
          transport: "auto",
          fastSupported: modelId !== "gpt-5.3-codex-spark",
        }
      },
      setFast: async () => ({ fast: true, transport: "auto" }),
    },
    t: (key) => key,
  }

  harness.mount(clientModule.CodexFastToggle, {
    ...props,
    useModelDirectory: (select) => select({ current: { provider: "other", model: "other" } }),
  })
  assert.equal(harness.tree(), null)
  harness.unmount()

  const unsupportedHarness = hookHarness()
  const unsupportedModule = await loadClientModule(unsupportedHarness.React)
  unsupportedHarness.mount(unsupportedModule.CodexFastToggle, {
    ...props,
    useModelDirectory: (select) => select({
      current: { provider: "dsh-codex", model: "gpt-5.3-codex-spark" },
    }),
  })
  await settle()
  unsupportedHarness.flush()
  await settle()
  unsupportedHarness.flush()
  assert.deepEqual(queriedModels, ["gpt-5.3-codex-spark"])
  const button = findElement(unsupportedHarness.tree(), (element) => element.type === "button")
  assert.ok(button)
  assert.equal(button.props.disabled, true)
  assert.equal(button.props["aria-label"], "fastUnsupported")
  unsupportedHarness.unmount()
})

test("legacy Off or Minimal selections require an explicit, disclosed repair action", async () => {
  for (const reasoningEffort of ["off", "minimal"]) {
    const harness = hookHarness()
    const clientModule = await loadClientModule(harness.React)
    const selections = []
    let rejectNextSelection = true
    const current = {
      provider: "dsh-codex",
      model: "gpt-5.6-sol",
      reasoningEffort,
    }
    const disclosure = "像模型选择器一样切换到当前默认推理档位，并保存为未来新会话的默认模型"
    const retryDisclosure = `重试：${disclosure}`
    const translations = {
      legacyReasoningRepair: disclosure,
      legacyReasoningRepairRetry: retryDisclosure,
      legacyReasoningRepairHelp: disclosure,
    }
    const t = (key) => translations[key] ?? key
    const selectModel = async (selection) => {
      selections.push(selection)
      if (rejectNextSelection) {
        rejectNextSelection = false
        throw new Error("temporary selection failure")
      }
    }
    const props = (select) => ({
      session: { removed: false },
      useModelDirectory: (project) => project({ current }),
      preferenceClient: {
        getForModel: async () => ({ fast: false, transport: "auto", fastSupported: true }),
        setFast: async () => ({ fast: false, transport: "auto" }),
      },
      selectModel: select,
      t,
    })

    harness.mount(clientModule.CodexFastToggle, props(selectModel))
    await settle()
    harness.flush()
    await settle()

    assert.deepEqual(plain(selections), [], `${reasoningEffort} must not mutate selection on mount`)
    let repairButton = findElement(
      harness.tree(),
      (element) => element.type === "button"
        && /未来新会话.*默认模型/u.test(element.props.title ?? ""),
    )
    assert.ok(repairButton, `${reasoningEffort} must expose an explicit repair button`)
    assert.match(repairButton.props.title, /模型选择器.*未来新会话.*默认模型/u)
    assert.match(textContent(repairButton), /模型选择器.*未来新会话.*默认模型/u)

    repairButton.props.onClick()
    await settle()
    harness.flush()
    await settle()

    assert.deepEqual(plain(selections), [{
      provider: "dsh-codex",
      model: "gpt-5.6-sol",
    }], `${reasoningEffort} must submit exactly once for one click`)

    // A failed selection may expose a retry state, but must never retry merely
    // because the component rerenders or receives a fresh callback identity.
    harness.mount(clientModule.CodexFastToggle, props((selection) => selectModel(selection)))
    await settle()
    harness.flush()
    await settle()
    assert.equal(selections.length, 1, `${reasoningEffort} failure must not trigger an automatic retry`)

    repairButton = findElement(
      harness.tree(),
      (element) => element.type === "button"
        && /未来新会话.*默认模型/u.test(element.props.title ?? ""),
    )
    assert.ok(repairButton, `${reasoningEffort} failure must keep a manual retry action`)
    assert.match(repairButton.props.title, /模型选择器.*未来新会话.*默认模型/u)
    assert.match(textContent(repairButton), /重试.*模型选择器.*未来新会话.*默认模型/u)

    repairButton.props.onClick()
    await settle()
    harness.flush()
    await settle()
    assert.deepEqual(plain(selections), [
      { provider: "dsh-codex", model: "gpt-5.6-sol" },
      { provider: "dsh-codex", model: "gpt-5.6-sol" },
    ], `${reasoningEffort} must retry only after a second user click`)
    harness.unmount()
  }
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
  const tree = harness.tree()
  harness.unmount()
  return { dictionaries, text, tree }
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

test("a single OAuth method uses the concise ChatGPT sign-in label", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  const client = { describe: async () => authorizationStatus(false) }

  harness.mount(clientModule.AuthorizationSettings, {
    client,
    t: (key) => dictionaries.zh[key] ?? key,
  })
  await settle()
  harness.flush()

  assert.ok(findElement(
    harness.tree(),
    (element) => element.type === "button" && textContent(element) === "使用 ChatGPT 登录",
  ))
  assert.equal(textContent(harness.tree()).includes("Sign in with ChatGPT"), false)
  harness.unmount()
})

test("OAuth notices copy only the displayed sign-in link or verification code after a click", async () => {
  const harness = hookHarness()
  const copied = []
  const clientModule = await loadClientModule(harness.React, {
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
  })
  const client = {
    describe: async () => ({
      flow: {
        key: "dsh-codex/openai-codex",
        label: "OpenAI Codex",
        methods: [{ id: "device", label: "Device" }],
        inFlight: false,
      },
      credential: { configured: false, state: "signed-out", writable: true },
      quota: { status: "unknown" },
    }),
    start: async () => ({ attemptId: "attempt-copy" }),
    watch: async () => ({
      attemptId: "attempt-copy",
      nextSeq: 1,
      done: true,
      events: [{
        seq: 1,
        type: "notice",
        notice: {
          message: "Complete sign-in",
          url: "https://example.test/device",
          code: "ABCD-EFGH",
        },
      }],
    }),
    cancel: async () => ({ accepted: true }),
    logout: async () => ({ signedOut: true }),
  }
  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  let tree = harness.flush()
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "signInWithChatGPT").props.onClick()
  await settle()
  tree = harness.flush()

  assert.equal(copied.length, 0)
  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "copyLoginLink").props.onClick()
  await settle()
  tree = harness.flush()
  assert.deepEqual(copied, ["https://example.test/device"])
  assert.match(textContent(tree), /copied/u)

  findElement(tree, (element) => element.type === "button"
    && textContent(element) === "copyVerificationCode").props.onClick()
  await settle()
  harness.flush()
  assert.deepEqual(copied, ["https://example.test/device", "ABCD-EFGH"])
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
  findElement(
    modelHarness.tree(),
    (element) => element.props.className === "dshCodexButton dshCodexModelToggle",
  ).props.onClick()
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
  assert.match(harness.styles[0].textContent, /gap:12px/u)

  const reloadedModule = await loadClientModule(
    { createElement: () => undefined },
    {},
    { document: harness.document, source: source.replace("gap:12px", "gap:15px") },
  )
  const disposeReloaded = applyClientModule(reloadedModule)
  assert.equal(harness.styles.length, 1)
  assert.match(harness.styles[0].textContent, /gap:15px/u)

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

test("the client replaces only the unique Codex settings gear with its code icon and cleans up", async () => {
  const createButton = (text, validStructure = true) => {
    const attributes = new Set()
    const label = validStructure ? { localName: "span", textContent: text } : undefined
    const icon = validStructure ? { localName: "svg", nextElementSibling: label } : undefined
    return {
      firstElementChild: icon,
      hasAttribute: (name) => attributes.has(name),
      removeAttribute: (name) => attributes.delete(name),
      setAttribute: (name) => attributes.add(name),
      setText(next) {
        if (label) label.textContent = next
      },
    }
  }
  const codexButton = createButton("OpenAI Codex")
  const duplicateButton = createButton("Other")
  const themeButton = createButton("Theme / 外观")
  const malformedButton = createButton("OpenAI Codex", false)
  const buttons = [codexButton, duplicateButton, themeButton, malformedButton]
  const styles = []
  const document = {
    body: {},
    head: {
      appendChild(style) {
        style.parentNode = this
        styles.push(style)
      },
      removeChild(style) {
        const index = styles.indexOf(style)
        if (index !== -1) styles.splice(index, 1)
        style.parentNode = null
      },
    },
    createElement(tag) {
      assert.equal(tag, "style")
      return {
        dataset: {},
        textContent: "",
        parentNode: null,
        remove() { this.parentNode?.removeChild(this) },
      }
    },
    querySelector(selector) {
      if (selector === 'style[data-plugin-css="dsh-codex-community/authorization-settings.css"]') {
        return styles.find((style) => style.dataset.pluginCss === "dsh-codex-community/authorization-settings.css") ?? null
      }
      if (selector === 'style[data-plugin-nav-icon="dsh-codex-community"]') {
        return styles.find((style) => style.dataset.pluginNavIcon === "dsh-codex-community") ?? null
      }
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[role="dialog"][aria-modal="true"] > nav button') return buttons
      if (selector === "[data-dsh-codex-community-nav-icon]") {
        return buttons.filter((button) => button.hasAttribute("data-dsh-codex-community-nav-icon"))
      }
      return []
    },
  }
  const observers = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }

    disconnect() { this.disconnected = true }
    observe(target, options) { this.observed = { target, options } }
  }
  const clientModule = await loadClientModule(
    { createElement: () => undefined },
    { MutationObserver: FakeMutationObserver },
    { document },
  )
  const dispose = applyClientModule(clientModule)

  assert.equal(observers.length, 1)
  assert.equal(codexButton.hasAttribute("data-dsh-codex-community-nav-icon"), true)
  assert.equal(themeButton.hasAttribute("data-dsh-codex-community-nav-icon"), false)
  assert.equal(malformedButton.hasAttribute("data-dsh-codex-community-nav-icon"), false)
  const navStyle = styles.find((style) => style.dataset.pluginNavIcon === "dsh-codex-community")
  assert.ok(navStyle)
  assert.match(navStyle.textContent, /data-dsh-codex-community-nav-icon/u)
  assert.match(navStyle.textContent, />svg:first-child\{display:none!important\}/u)
  assert.match(decodeURIComponent(navStyle.textContent), /M5\.25 3\.25 1\.5 8l3\.75 4\.75/u)
  assert.doesNotMatch(decodeURIComponent(navStyle.textContent), /M8\.00192 6\.64454/u)

  duplicateButton.setText("OpenAI Codex")
  observers[0].callback([{
    addedNodes: [],
    removedNodes: [],
    target: {
      nodeType: 1,
      closest: (selector) => selector === '[role="dialog"][aria-modal="true"] > nav' ? {} : null,
    },
  }])
  await Promise.resolve()
  assert.equal(codexButton.hasAttribute("data-dsh-codex-community-nav-icon"), false)
  assert.equal(duplicateButton.hasAttribute("data-dsh-codex-community-nav-icon"), false)

  dispose()
  assert.equal(observers[0].disconnected, true)
  assert.equal(styles.some((style) => style.dataset.pluginNavIcon === "dsh-codex-community"), false)
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
  assert.match(css, /\.dshCodexPage\{[^}]*width:100%[^}]*font:inherit/u)
  assert.doesNotMatch(css, /\[role=dialog\]/u)
  assert.match(css, /\.dshCodexHero h2\{font-size:16px;font-weight:500;line-height:24px\}/u)
  assert.match(css, /\.dshCodexCard\{[^}]*var\(--dsw-alias-bg-module-platform/u)
  assert.match(css, /\.dshCodexModelList\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u)
  assert.match(css, /@media\(max-width:760px\)\{\.dshCodexQuotaWindows,\.dshCodexModelList,\.dshCodexDiagnosticsModes,\.dshCodexDiagnosticsChecks\{grid-template-columns:1fr\}/u)
  assert.match(css, /\.dshCodexButton:focus-visible,[^{]+input:focus-visible/u)
  assert.match(css, /\.dshCodexDefaultsRow\{[^}]*position:relative[^}]*min-height:44px/u)
  assert.match(css, /\.dshCodexDefaultsSelectVisual\{[^}]*border-radius:8px[^}]*pointer-events:none/u)
  assert.match(css, /\.dshCodexDefaultsNativeSelect\{[^}]*position:absolute[^}]*inset:0[^}]*width:100%[^}]*height:100%[^}]*opacity:0[^}]*font:inherit/u)
  assert.match(css, /\.dshCodexDefaultsRow:has\(\.dshCodexDefaultsCheckbox:focus-visible\),\.dshCodexDefaultsRow:has\(\.dshCodexDefaultsNativeSelect:focus-visible\)/u)
  assert.match(css, /\.dshCodexDefaultsCheckbox\{[^}]*width:18px[^}]*accent-color:/u)
  assert.match(css, /\.dshCodexModelId\{[^}]*font-family:inherit/u)
  assert.match(css, /\.dshCodexModelCapabilities\{[^}]*flex-wrap:wrap/u)
  assert.match(css, /\.dshCodexModelBadge\{[^}]*border-radius:999px[^}]*font-family:inherit/u)
  assert.match(css, /\.dshCodexFastToggle\{[^}]*width:28px[^}]*font:inherit/u)
  assert.match(css, /\.dshCodexFastToggle\[data-fast=true\]/u)
  assert.match(css, /\.dshCodexTransportControl\{[^}]*position:relative/u)
  assert.match(css, /\.dshCodexTransportToggle\{[^}]*width:28px[^}]*font:inherit/u)
  assert.match(css, /\.dshCodexTransportMenu\{[^}]*bottom:calc\(100% \+ 8px\)[^}]*max-width:calc\(100vw - 32px\)/u)
  assert.match(css, /\.dshCodexTransportOption:focus-visible/u)
  assert.match(css, /\.dshCodexDiagnostics\{[^}]*border-radius:12px/u)
  assert.match(css, /\.dshCodexDiagnosticsToggle\{[^}]*font:inherit/u)
  assert.match(css, /\.dshCodexDiagnosticsChecks code,[^{]+\{[^}]*font:inherit/u)
  assert.match(css, /\.dshCodexDiagnosticsConsent\{[^}]*state-warning-primary[^}]*font-size:12px/u)
  assert.match(css, /\.dshCodexDiagnosticsHistoryList\{[^}]*max-height:220px[^}]*overflow:auto/u)
  assert.match(css, /\.dshCodexDiagnosticsHistoryList code\{[^}]*overflow-wrap:anywhere[^}]*font:inherit/u)
  assert.match(css, /@media\(max-width:480px\)\{/u)
  assert.match(css, /\.dshCodexDiagnosticsMode\{flex-direction:column\}/u)
  assert.match(css, /\.dshCodexDiagnosticsMode \.dshCodexButton\{width:100%;min-width:0\}/u)
  assert.match(css, /\.dshCodexDiagnosticsMode>span\{max-width:100%;overflow-wrap:anywhere\}/u)
  assert.match(css, /\.dshCodexQuotaWindow progress\{[^}]*width:100%[^}]*height:8px/u)
  assert.match(css, /\.dshCodexQuotaWindows\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u)
  assert.match(css, /\.dshCodexQuota \.dshCodexQuotaUpdated\{[^}]*font-size:12px[^}]*line-height:18px/u)
  assert.match(css, /\.dshCodexRefreshButton\[data-loading=true\] \.dshCodexRefreshIcon\{animation:/u)
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/u)
  assert.match(css, /\.dshCodexModelOption\[data-selected=true\]/u)
  assert.match(css, /\.dshCodexModelToggle\{[^}]*align-self:center/u)
  assert.match(css, /\.dshCodexModelSummary\{[^}]*font-size:12px[^}]*white-space:nowrap/u)
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
  const resetAt = Date.now() + 2 * 60 * 60_000
  const requestId = "req_quota_ui_fixture"
  const extra = "secret_quota_ui_fixture"

  for (const language of ["zh", "en"]) {
    const { dictionaries, text, tree } = await renderQuotaView({
      status: "exhausted",
      observedAt,
      resetAt,
      requestId,
      diagnostic: extra,
    }, language)
    const messages = dictionaries[language]

    assert.ok(text.includes(messages.quotaExhausted))
    assert.ok(text.includes(messages.quotaObservedAt))
    assert.ok(text.includes(new Date(observedAt).toLocaleString(messages.locale)))
    assert.ok(text.includes(messages.quotaResetAt))
    assert.equal(text.includes(new Date(resetAt).toLocaleString(messages.locale)), false)
    assert.match(text, language === "zh" ? /账户额度已用尽.*2 小时后重置/u : /account quota was exhausted.*Resets in 2 hours/iu)
    const resetTime = findElement(tree, (element) => element.type === "time")
    assert.ok(resetTime)
    assert.equal(resetTime.props.dateTime, new Date(resetAt).toISOString())
    assert.match(resetTime.props.title, new RegExp(new Date(resetAt).toLocaleString(messages.locale).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
    assert.match(resetTime.props["aria-label"], language === "zh" ? /2 小时后重置.*重置时间/u : /Resets in 2 hours.*Resets/iu)
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
    assert.ok(text.includes(new Date(observedAt).toLocaleString(messages.locale)))
    assert.ok(text.includes(messages.quotaNoReset))
    assert.match(text, language === "zh" ? /账户额度已用尽.*未获得通过校验的重置时间/u : /account quota was exhausted.*no reset time passed validation/iu)
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
    assert.ok(text.includes(new Date(observedAt).toLocaleString(messages.locale)))
    assert.match(text, language === "zh" ? /最近一次 Codex 请求成功.*不代表账户剩余额度/u : /latest Codex request succeeded.*does not represent remaining account quota/iu)
    assert.equal(text.includes(messages.quotaExhausted), false)
    assert.equal(text.includes(messages.quotaUnknown), false)
    assert.equal(text.includes(requestId), false)
    assert.equal(text.includes(extra), false)
  }
})

test("quota UI never invents percentages or progress bars", async () => {
  for (const quota of [
    { status: "unknown" },
    { status: "recent-success", observedAt: Date.now() - 1_000 },
    { status: "exhausted", observedAt: Date.now() - 1_000, resetAt: Date.now() + 60_000 },
  ]) {
    const { text, tree } = await renderQuotaView(quota, "zh")
    assert.equal(text.includes("%"), false)
    assert.equal(findElements(tree, (element) => element.type === "progress").length, 0)
    assert.equal(findElements(tree, (element) => element.props?.role === "progressbar").length, 0)
    assert.equal(findElements(tree, (element) => element.props?.["aria-valuenow"] !== undefined).length, 0)
    const section = findElement(tree, (element) => element.props?.["data-quota-status"] === quota.status)
    assert.ok(section)
  }
})

test("quota reset distance is concise and localized without exposing the exact timestamp as visible text", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const dictionaries = registeredClientDictionaries(clientModule)
  const now = Date.UTC(2026, 7, 29, 8, 0)
  const zh = (key) => dictionaries.zh[key] ?? key
  const en = (key) => dictionaries.en[key] ?? key

  assert.equal(clientModule.formatResetDistance(now + 30_000, zh, now), "即将重置")
  assert.equal(clientModule.formatResetDistance(now + 6 * 60_000, zh, now), "6 分钟后重置")
  assert.equal(clientModule.formatResetDistance(now + 3 * 60 * 60_000, zh, now), "3 小时后重置")
  assert.equal(clientModule.formatResetDistance(now + 6 * 24 * 60 * 60_000, zh, now), "6 天后重置")
  assert.equal(clientModule.formatResetDistance(now + 60_000, en, now), "Resets soon")
  assert.equal(clientModule.formatResetDistance(now + 61_000, en, now), "Resets in 2 minutes")
  assert.equal(clientModule.formatResetDistance(now + 60 * 60_000, en, now), "Resets in 1 hour")
  assert.equal(clientModule.formatResetDistance(now + 6 * 24 * 60 * 60_000, en, now), "Resets in 6 days")
})

test("signed-in settings shows the five-hour exact reset and a distant weekly relative reset", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  let usageCalls = 0
  const now = Date.now()
  const observedAt = now - 60_000
  const primaryReset = now + 3 * 60 * 60_000
  const secondaryReset = now + 6 * 24 * 60 * 60_000
  const usage = {
    observedAt,
    planType: "plus",
    rateLimits: [{
      limitId: "codex",
      limitName: "Codex",
      primary: {
        usedPercent: 25,
        windowDurationMins: 300,
        resetsAt: primaryReset,
      },
      secondary: {
        usedPercent: 7.5,
        windowDurationMins: 10_080,
        resetsAt: secondaryReset,
      },
    }],
  }
  const client = {
    describe: async () => authorizationStatus(true),
    usage: async () => {
      usageCalls += 1
      return usage
    },
  }

  harness.mount(clientModule.AuthorizationSettings, {
    client,
    t: (key) => dictionaries.zh[key] ?? key,
  })
  await settle()
  harness.flush()

  assert.equal(usageCalls, 1)
  const progress = findElements(harness.tree(), (element) => element.type === "progress")
  assert.deepEqual(progress.map(({ props }) => props.value), [75, 92.5])
  const text = textContent(harness.tree())
  assert.match(text, /5 小时额度/u)
  assert.match(text, /每周额度/u)
  assert.match(text, /套餐：plus/u)
  assert.match(text, /剩余 75%/u)
  assert.match(text, /剩余 92\.5%/u)
  assert.doesNotMatch(text, /已使用/u)
  assert.doesNotMatch(text, /3 小时后重置/u)
  assert.match(text, /6 天后重置/u)
  assert.equal(text.includes(`${dictionaries.zh.quotaResetsAt}：${new Date(primaryReset).toLocaleString(dictionaries.zh.locale)}`), true)
  assert.equal(text.includes(new Date(secondaryReset).toLocaleString(dictionaries.zh.locale)), false)
  const resetTimes = findElements(harness.tree(), (element) => element.type === "time")
  assert.deepEqual(resetTimes.map(({ props }) => props.dateTime), [
    new Date(primaryReset).toISOString(),
    new Date(secondaryReset).toISOString(),
  ])
  for (const resetTime of resetTimes) {
    assert.match(resetTime.props.title, /重置时间/u)
  }
  assert.equal(resetTimes[0].props["aria-label"], `${dictionaries.zh.quotaResetsAt}：${new Date(primaryReset).toLocaleString(dictionaries.zh.locale)}`)
  assert.match(resetTimes[1].props["aria-label"], /6 天后重置.*重置时间/u)
  assert.equal(text.match(/Codex/gu)?.length, 1)

  const refresh = findElement(
    harness.tree(),
    (element) => element.type === "button" && textContent(element) === dictionaries.zh.refresh,
  )
  refresh.props.onClick()
  await settle()
  harness.flush()
  assert.equal(usageCalls, 2)
  harness.unmount()
})

test("smart usage scheduling advances weekly relative days locally and refreshes only at reset", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const now = 1_800_000_000_000
  const resetsAt = now + 3 * 24 * 60 * 60_000
  const usage = {
    observedAt: now,
    rateLimits: [{
      limitId: "codex",
      secondary: {
        usedPercent: 7,
        windowDurationMins: 10_080,
        resetsAt,
      },
    }],
  }

  assert.deepEqual(
    { ...clientModule.nextAccountUsageTransition(usage, now) },
    { at: resetsAt - 2 * 24 * 60 * 60_000, refresh: false },
  )
  assert.deepEqual(
    { ...clientModule.nextAccountUsageTransition(usage, resetsAt - 2 * 24 * 60 * 60_000) },
    { at: resetsAt - 24 * 60 * 60_000, refresh: false },
  )
  assert.deepEqual(
    { ...clientModule.nextAccountUsageTransition(usage, resetsAt - 23 * 60 * 60_000) },
    { at: resetsAt, refresh: true },
  )
  assert.equal(clientModule.nextAccountUsageTransition(usage, resetsAt), undefined)
})

test("weekly relative-day boundary rerenders without another usage request", async () => {
  const harness = hookHarness()
  const timers = []
  const dayMs = 24 * 60 * 60_000
  let now = 1_800_000_000_000
  const initialNow = now
  const resetsAt = initialNow + 3 * dayMs
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length === 0 ? [now] : args))
    }

    static now() {
      return now
    }
  }
  const clientModule = await loadClientModule(harness.React, {
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false })
      return timers.length
    },
    clearTimeout(id) {
      if (timers[id - 1] !== undefined) timers[id - 1].cleared = true
    },
  }, { globals: { Date: FakeDate } })
  const dictionaries = registeredClientDictionaries(clientModule)
  let usageCalls = 0
  const client = {
    describe: async () => authorizationStatus(true),
    usage: async () => {
      usageCalls += 1
      return {
        observedAt: initialNow,
        rateLimits: [{
          limitId: "codex",
          secondary: {
            usedPercent: 7,
            windowDurationMins: 10_080,
            resetsAt,
          },
        }],
      }
    },
  }

  harness.mount(clientModule.AuthorizationSettings, {
    client,
    t: (key) => dictionaries.zh[key] ?? key,
  })
  await settle()
  harness.flush()

  assert.equal(usageCalls, 1)
  assert.match(textContent(harness.tree()), /3 天后重置/u)
  const dayBoundary = timers.find(({ delay, cleared }) => !cleared && delay === dayMs)
  assert.ok(dayBoundary)

  now = resetsAt - 2 * dayMs
  dayBoundary.callback()
  harness.flush()

  assert.equal(usageCalls, 1)
  assert.match(textContent(harness.tree()), /2 天后重置/u)
  const nextBoundary = timers.find(({ delay, cleared }) => !cleared && delay === dayMs)
  assert.ok(nextBoundary)
  harness.unmount()
})

test("quota reminders use only validated Codex five-hour and weekly low-balance windows", async () => {
  const clientModule = await loadClientModule({ createElement: () => undefined })
  const now = 1_800_000_000_000
  const reminders = clientModule.accountUsageReminders({
    observedAt: now,
    rateLimits: [
      {
        limitId: "codex",
        primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: now + 60_000 },
        secondary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: now + 120_000 },
      },
      {
        limitId: "codex",
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: now - 1 },
      },
      {
        limitId: "other",
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: now + 60_000 },
      },
      {
        limitId: "codex",
        primary: { usedPercent: 100, windowDurationMins: 60, resetsAt: now + 60_000 },
      },
    ],
  }, now)

  assert.deepEqual(plain(reminders), [
    {
      kind: "low",
      windowDurationMins: 300,
      remainingPercent: 20,
      resetsAt: now + 60_000,
    },
    {
      kind: "exhausted",
      windowDurationMins: 10_080,
      remainingPercent: 0,
      resetsAt: now + 120_000,
    },
  ])
  assert.deepEqual(plain(clientModule.accountUsageReminders({
    observedAt: now,
    rateLimits: [{
      limitId: "codex",
      primary: { usedPercent: 79.9, windowDurationMins: 300, resetsAt: now + 60_000 },
    }],
  }, now)), [])
})

test("quota reminders announce low balance politely and exhaustion assertively", async () => {
  for (const [usedPercent, role, live, copy] of [
    [85, "status", "polite", "quotaReminderLow"],
    [100, "alert", "assertive", "quotaReminderExhausted"],
  ]) {
    const harness = hookHarness()
    const clientModule = await loadClientModule(harness.React)
    const client = {
      describe: async () => authorizationStatus(true),
      usage: async () => ({
        observedAt: Date.now(),
        rateLimits: [{
          limitId: "codex",
          primary: {
            usedPercent,
            windowDurationMins: 300,
            resetsAt: Date.now() + 60 * 60_000,
          },
        }],
      }),
    }
    harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
    await settle()
    harness.flush()

    const reminder = findElement(
      harness.tree(),
      (element) => element.props.className === `dshCodexQuotaReminder dshCodexQuotaReminder-${usedPercent === 100 ? "exhausted" : "low"}`,
    )
    assert.equal(reminder.props.role, role)
    assert.equal(reminder.props["aria-live"], live)
    assert.match(textContent(reminder), new RegExp(copy, "u"))
    const quota = findElement(harness.tree(), (element) => element.props.className === "dshCodexQuota")
    assert.equal(quota.props["aria-live"], undefined)
    harness.unmount()
  }
})

test("quota reset boundary performs one refresh and reports confirmation", async () => {
  const harness = hookHarness()
  const timers = []
  const clientModule = await loadClientModule(harness.React, {
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false })
      return timers.length
    },
    clearTimeout(id) {
      if (timers[id - 1] !== undefined) timers[id - 1].cleared = true
    },
  })
  const resetUsage = deferred()
  let usageCalls = 0
  const initialNow = Date.now()
  const client = {
    describe: async () => authorizationStatus(true),
    usage: async () => {
      usageCalls += 1
      if (usageCalls === 1) {
        return {
          observedAt: initialNow,
          rateLimits: [{
            limitId: "codex",
            primary: {
              usedPercent: 95,
              windowDurationMins: 300,
              resetsAt: initialNow + 500,
            },
          }],
        }
      }
      return resetUsage.promise
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  const resetTimer = timers.find(({ delay, cleared }) => !cleared && delay <= 1_000)
  assert.ok(resetTimer)
  resetTimer.callback()
  await settle()
  harness.flush()
  assert.equal(usageCalls, 2)
  assert.match(textContent(harness.tree()), /quotaResetRefreshing/u)

  resetUsage.resolve({
    observedAt: Date.now(),
    rateLimits: [{
      limitId: "codex",
      primary: {
        usedPercent: 0,
        windowDurationMins: 300,
        resetsAt: Date.now() + 5 * 60 * 60_000,
      },
    }],
  })
  await settle()
  harness.flush()
  assert.match(textContent(harness.tree()), /quotaResetConfirmed/u)
  harness.unmount()
})

test("account usage refreshes once when the visible settings page regains focus", async () => {
  const harness = hookHarness()
  let visibilityListener
  const document = {
    visibilityState: "visible",
    addEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListener = listener
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange" && visibilityListener === listener) visibilityListener = undefined
    },
  }
  const clientModule = await loadClientModule(harness.React, {}, { document })
  let usageCalls = 0
  const now = Date.now()
  const client = {
    describe: async () => authorizationStatus(true),
    usage: async () => {
      usageCalls += 1
      return {
        observedAt: now,
        rateLimits: [{
          limitId: "codex",
          primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: now + 60_000 },
        }],
      }
    },
  }
  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  assert.equal(usageCalls, 1)
  visibilityListener()
  await settle()
  harness.flush()
  assert.equal(usageCalls, 2)
  harness.unmount()
})

test("weekly usage switches from a relative day count to the exact reset below 24 hours", async () => {
  for (const language of ["zh", "en"]) {
    const harness = hookHarness()
    const clientModule = await loadClientModule(harness.React)
    const dictionaries = registeredClientDictionaries(clientModule)
    const messages = dictionaries[language]
    const now = Date.now()
    const primaryReset = now + 4 * 60 * 60_000
    const weeklyReset = now + 23 * 60 * 60_000
    const client = {
      describe: async () => authorizationStatus(true),
      usage: async () => ({
        observedAt: now,
        rateLimits: [{
          limitId: "codex",
          primary: {
            usedPercent: 1,
            windowDurationMins: 300,
            resetsAt: primaryReset,
          },
          secondary: {
            usedPercent: 2,
            windowDurationMins: 10_080,
            resetsAt: weeklyReset,
          },
        }],
      }),
    }

    harness.mount(clientModule.AuthorizationSettings, {
      client,
      t: (key) => messages[key] ?? key,
    })
    await settle()
    harness.flush()

    const text = textContent(harness.tree())
    const separator = messages.locale.toLowerCase().startsWith("zh") ? "：" : ": "
    const primaryExact = `${messages.quotaResetsAt}${separator}${new Date(primaryReset).toLocaleString(messages.locale)}`
    const weeklyExact = `${messages.quotaResetsAt}${separator}${new Date(weeklyReset).toLocaleString(messages.locale)}`
    assert.ok(text.includes(primaryExact))
    assert.ok(text.includes(weeklyExact))
    assert.equal(text.includes(clientModule.formatResetDistance(weeklyReset, (key) => messages[key] ?? key, now)), false)
    const resetTimes = findElements(harness.tree(), (element) => element.type === "time")
    assert.deepEqual(resetTimes.map((element) => element.props["aria-label"]), [primaryExact, weeklyExact])
    harness.unmount()
  }
})

test("usage refresh button exposes an icon and a localized busy state", async () => {
  for (const language of ["zh", "en"]) {
    const harness = hookHarness()
    const clientModule = await loadClientModule(harness.React)
    const dictionaries = registeredClientDictionaries(clientModule)
    const pendingUsage = deferred()
    const client = {
      describe: async () => authorizationStatus(true),
      usage: async () => pendingUsage.promise,
    }

    harness.mount(clientModule.AuthorizationSettings, {
      client,
      t: (key) => dictionaries[language][key] ?? key,
    })
    await settle()
    harness.flush()

    let refresh = findElement(
      harness.tree(),
      (element) => element.type === "button" && element.props.className === "dshCodexButton dshCodexRefreshButton",
    )
    assert.equal(textContent(refresh), dictionaries[language].refreshing)
    assert.equal(refresh.props.disabled, true)
    assert.equal(refresh.props["aria-busy"], "true")
    assert.equal(refresh.props["data-loading"], "true")
    const icon = findElement(refresh, (element) => element.type === "svg" && element.props.className === "dshCodexRefreshIcon")
    assert.ok(icon)
    assert.equal(icon.props["aria-hidden"], "true")
    assert.equal(icon.props.focusable, "false")
    const quota = findElement(harness.tree(), (element) => element.props.className === "dshCodexQuota")
    assert.equal(quota.props["aria-busy"], "true")

    pendingUsage.resolve({
      observedAt: Date.now(),
      rateLimits: [{
        limitId: "codex",
        primary: {
          usedPercent: 10,
          windowDurationMins: 300,
          resetsAt: Date.now() + 60 * 60_000,
        },
      }],
    })
    await settle()
    harness.flush()

    refresh = findElement(
      harness.tree(),
      (element) => element.type === "button" && element.props.className === "dshCodexButton dshCodexRefreshButton",
    )
    assert.equal(textContent(refresh), dictionaries[language].refresh)
    assert.equal(refresh.props.disabled, false)
    assert.equal(refresh.props["aria-busy"], undefined)
    assert.equal(refresh.props["data-loading"], undefined)
    assert.equal(
      findElement(harness.tree(), (element) => element.props.className === "dshCodexQuota").props["aria-busy"],
      undefined,
    )
    harness.unmount()
  }
})

test("usage refresh failure preserves the last verified percentages and marks them stale", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  let usageCalls = 0
  const client = {
    describe: async () => authorizationStatus(true),
    async usage() {
      usageCalls += 1
      if (usageCalls > 1) throw new Error("sensitive upstream detail")
      return {
        observedAt: Date.now(),
        rateLimits: [{
          limitId: "codex",
          primary: {
            usedPercent: 40,
            windowDurationMins: 300,
            resetsAt: Date.now() + 60_000,
          },
        }],
      }
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  const refresh = findElement(
    harness.tree(),
    (element) => element.type === "button" && textContent(element) === "refresh",
  )
  refresh.props.onClick()
  await settle()
  harness.flush()

  const progress = findElements(harness.tree(), (element) => element.type === "progress")
  assert.deepEqual(progress.map(({ props }) => props.value), [60])
  assert.match(textContent(harness.tree()), /quotaLoadFailed/u)
  assert.doesNotMatch(textContent(harness.tree()), /sensitive upstream detail/u)
  harness.unmount()
})

test("re-authorizing never carries verified usage from the previous account", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  let usageCalls = 0
  const client = {
    describe: async () => authorizationStatus(true),
    async usage() {
      usageCalls += 1
      if (usageCalls > 1) throw new Error("new account usage unavailable")
      return {
        observedAt: Date.now(),
        rateLimits: [{
          limitId: "codex",
          primary: {
            usedPercent: 40,
            windowDurationMins: 300,
            resetsAt: Date.now() + 60_000,
          },
        }],
      }
    },
    start: async () => ({ attemptId: "replace-account" }),
    watch: async () => ({
      events: [{ seq: 1, type: "settled", status: "authorized" }],
      nextSeq: 1,
      done: true,
    }),
    cancel: async () => ({ accepted: true }),
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  assert.deepEqual(
    findElements(harness.tree(), (element) => element.type === "progress")
      .map(({ props }) => props.value),
    [60],
  )

  findElement(
    harness.tree(),
    (element) => element.type === "button" && textContent(element) === "signInAgain",
  ).props.onClick()
  await settle()
  harness.flush()

  assert.equal(usageCalls, 2)
  assert.equal(findElements(harness.tree(), (element) => element.type === "progress").length, 0)
  assert.doesNotMatch(textContent(harness.tree()), /60%|new account usage unavailable/u)
  harness.unmount()
})

test("signed-out settings never request account usage", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  let usageCalls = 0
  const client = {
    describe: async () => authorizationStatus(false),
    usage: async () => {
      usageCalls += 1
      return { observedAt: Date.now(), rateLimits: [] }
    },
  }

  harness.mount(clientModule.AuthorizationSettings, { client, t: (key) => key })
  await settle()
  harness.flush()
  assert.equal(usageCalls, 0)
  harness.unmount()
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
              {
                id: "gpt-a",
                name: "GPT A",
                contextWindow: 272_000,
                maxTokens: 128_000,
                ignored: true,
              },
              { id: "gpt-b", name: "GPT B", contextWindow: 0, maxTokens: 1.5 },
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
    rpc: {
      async call(channel, endpoint, payload, receivedSignal) {
        calls.push({ method: "modelCapabilities", channel, endpoint, payload, signal: receivedSignal })
        return {
          ok: true,
          value: {
            models: [
              {
                id: "gpt-a",
                name: "Capability name must not replace discovery",
                contextWindow: 1,
                maxTokens: 2,
                inputModalities: ["text", "image", "audio", "text"],
                reasoning: {
                  efforts: [
                    { id: "low", name: "Low" },
                    { id: "high", name: "High" },
                  ],
                  defaultEffort: "low",
                },
                fast: true,
                ignored: true,
              },
              { id: "capability-only-model", fast: true },
            ],
          },
        }
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
    {
      id: "gpt-a",
      name: "GPT A",
      contextWindow: 272_000,
      maxTokens: 128_000,
      inputModalities: ["text", "image"],
      reasoning: {
        efforts: [
          { id: "low", name: "Low" },
          { id: "high", name: "High" },
        ],
        defaultEffort: "low",
      },
      fast: true,
    },
    { id: "gpt-b", name: "GPT B" },
  ])
  assert.deepEqual([...snapshot.catalogIds], ["gpt-a", "gpt-b"])
  assert.deepEqual([...snapshot.selectedIds], ["gpt-a"])
  assert.deepEqual(plain(snapshot.configuredModels), [
    { id: "gpt-a", futureField: { enabled: true } },
  ])
  assert.deepEqual(calls.map((call) => call.method), ["discoverModels", "ensure", "modelCapabilities"])
  assert.deepEqual(plain(calls[0].payload), { settingsNs: "dsh-codex", provider: "dsh-codex" })
  assert.equal(calls[0].signal, signal)
  assert.equal(calls[2].channel, clientModule.MODEL_CAPABILITIES_CHANNEL)
  assert.equal(calls[2].endpoint, "get")
  assert.deepEqual(plain(calls[2].payload), {})
  assert.equal(calls[2].signal, signal)
})

test("model settings formats exact catalog capabilities and never infers them for unknown models", async () => {
  const ready = {
    kind: "ready",
    writable: true,
    revision: 1,
    settingsNs: "dsh-codex",
    settingsPath: [],
    models: [
      {
        id: "gpt-codex",
        name: "GPT Codex",
        contextWindow: 272_000,
        maxTokens: 128_000,
        inputModalities: ["text", "image"],
        fast: true,
        reasoning: {
          efforts: [
            { id: "low", name: "Low" },
            { id: "medium", name: "Medium" },
            { id: "high", name: "High" },
          ],
        },
      },
      { id: "gpt-without-metadata", name: "No metadata" },
    ],
    catalogIds: ["gpt-codex", "gpt-without-metadata"],
    selectedIds: ["gpt-codex", "gpt-without-metadata"],
    configuredModels: [],
  }

  for (const { locale, contextLabel, outputLabel, reasoningLabel } of [
    {
      locale: "zh",
      contextLabel: "上下文 272K",
      outputLabel: "最大输出 128K",
      reasoningLabel: "推理 Low–High",
    },
    {
      locale: "en",
      contextLabel: "Context 272K",
      outputLabel: "Max output 128K",
      reasoningLabel: "Reasoning Low–High",
    },
  ]) {
    const harness = hookHarness()
    const clientModule = await loadClientModule(harness.React)
    const dictionaries = registeredClientDictionaries(clientModule)
    harness.mount(clientModule.ModelEnablementSettings, {
      client: {
        available: true,
        load: async () => ready,
        save: async () => ready,
        subscribe: () => () => undefined,
      },
      t: (key) => dictionaries[locale][key] ?? key,
    })
    await settle()
    harness.flush()

    const text = textContent(harness.tree())
    assert.match(text, new RegExp(contextLabel, "u"))
    assert.match(text, new RegExp(outputLabel, "u"))
    assert.match(text, new RegExp(reasoningLabel, "u"))
    assert.doesNotMatch(text, /默认 Medium|default Medium/iu)
    assert.match(text, /Text input|文本输入/u)
    assert.match(text, /Image input|图片输入/u)
    assert.match(text, /Fast 1\.5×/u)
    assert.doesNotMatch(text, /272,000 tokens/u)
    assert.doesNotMatch(text, /128,000 tokens/u)
    assert.doesNotMatch(text, /推理档位|reasoning effort|not-a-catalog-field/iu)
    assert.deepEqual(
      findElements(harness.tree(), (element) => element.props.className === "dshCodexModelId")
        .map((element) => textContent(element)),
      ["gpt-codex", "gpt-without-metadata"],
    )
    assert.equal(findElements(harness.tree(), (element) => element.props.className === "dshCodexModelBadge").length, 6)
    harness.unmount()
  }
})

test("selected models stay above a collapsible group of unselected models", async () => {
  const harness = hookHarness()
  const clientModule = await loadClientModule(harness.React)
  const dictionaries = registeredClientDictionaries(clientModule)
  const models = Array.from({ length: 7 }, (_, index) => ({
    id: `gpt-codex-${index + 1}`,
    name: `GPT Codex ${index + 1}`,
    contextWindow: 272_000,
    maxTokens: 128_000,
  }))
  const ready = {
    kind: "ready",
    writable: true,
    revision: 1,
    settingsNs: "dsh-codex",
    settingsPath: [],
    models,
    catalogIds: models.map(({ id }) => id),
    selectedIds: models.slice(3).map(({ id }) => id),
    configuredModels: [],
  }

  harness.mount(clientModule.ModelEnablementSettings, {
    client: {
      available: true,
      load: async () => ready,
      save: async () => ready,
      subscribe: () => () => undefined,
    },
    t: (key) => dictionaries.zh[key] ?? key,
  })
  await settle()
  harness.flush()

  let list = findElement(harness.tree(), (element) => element.props.id === "dsh-codex-model-list")
  assert.ok(list)
  assert.equal(list.type, "ul")
  assert.equal(list.props["aria-labelledby"], "dsh-codex-models-title")
  let checkboxes = findElements(list, (element) => element.type === "input" && element.props.type === "checkbox")
  assert.equal(checkboxes.length, 4)
  assert.deepEqual(checkboxes.map(({ props }) => props.checked), [true, true, true, true])
  assert.deepEqual(list.children.map(textContent), ["GPT Codex 4gpt-codex-4上下文 272K最大输出 128K", "GPT Codex 5gpt-codex-5上下文 272K最大输出 128K", "GPT Codex 6gpt-codex-6上下文 272K最大输出 128K", "GPT Codex 7gpt-codex-7上下文 272K最大输出 128K"])
  assert.equal(findElements(list, (element) => element.type === "button").length, 0)
  let summary = findElement(harness.tree(), (element) => element.props.className === "dshCodexModelSummary")
  assert.equal(textContent(summary), "已选择 4/7 · 当前显示 4/7")
  let toggle = findElement(harness.tree(), (element) => element.props.className === "dshCodexButton dshCodexModelToggle")
  assert.equal(textContent(toggle), "显示未选择的 3 个模型")
  assert.equal(toggle.props["aria-expanded"], "false")
  assert.equal(toggle.props["aria-controls"], "dsh-codex-model-list")

  toggle.props.onClick()
  harness.flush()
  list = findElement(harness.tree(), (element) => element.props.id === "dsh-codex-model-list")
  checkboxes = findElements(list, (element) => element.type === "input" && element.props.type === "checkbox")
  assert.equal(checkboxes.length, 7)
  assert.deepEqual(checkboxes.map(({ props }) => props.checked), [true, true, true, true, false, false, false])
  assert.deepEqual(list.children.map(textContent).map((value) => value.match(/GPT Codex \d+/u)?.[0]), ["GPT Codex 4", "GPT Codex 5", "GPT Codex 6", "GPT Codex 7", "GPT Codex 1", "GPT Codex 2", "GPT Codex 3"])
  summary = findElement(harness.tree(), (element) => element.props.className === "dshCodexModelSummary")
  assert.equal(textContent(summary), "已选择 4/7 · 当前显示 7/7")
  toggle = findElement(harness.tree(), (element) => element.props.className === "dshCodexButton dshCodexModelToggle")
  assert.equal(textContent(toggle), "收起未选择的模型")
  assert.equal(toggle.props["aria-expanded"], "true")
  assert.ok(findElement(harness.tree(), (element) => element.props.className === "dshCodexActions dshCodexModelActions"))

  toggle.props.onClick()
  harness.flush()
  list = findElement(harness.tree(), (element) => element.props.id === "dsh-codex-model-list")
  assert.equal(findElements(list, (element) => element.type === "input" && element.props.type === "checkbox").length, 4)

  toggle = findElement(harness.tree(), (element) => element.props.className === "dshCodexButton dshCodexModelToggle")
  let focusCalls = 0
  toggle.props.ref.current = { focus: () => { focusCalls += 1 } }
  const firstSelected = findElement(list, (element) => element.type === "input" && element.props.type === "checkbox")
  firstSelected.props.onChange()
  harness.flush()
  assert.equal(focusCalls, 1)
  assert.equal(textContent(findElement(harness.tree(), (element) => element.props.className === "dshCodexButton dshCodexModelToggle")), "显示未选择的 4 个模型")
  harness.unmount()
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
      "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-client-ui-model-selection",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-locale",
    ],
    platform: "web",
  })
  for (const dependency of [
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-model-selection",
  ]) {
    assert.equal(manifest.peerDependencies[dependency], "0.1.1-rc.2")
    assert.deepEqual(manifest.peerDependenciesMeta[dependency], { optional: true })
  }
})
