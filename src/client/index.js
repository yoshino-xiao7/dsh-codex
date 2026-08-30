window.__ModuleLoader__.load({
  id: "dsh-codex-community",
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require("react")
    const h = React.createElement

    const CHANNEL = "/dsh-codex"
    const SESSION_CHANNEL = "/dsh-codex-session"
    const DIAGNOSTICS_CHANNEL = "/dsh-codex-diagnostics"
    const NS = "settings.codex"
    const CODEX_PROVIDER = "dsh-codex"
    const CODEX_SETTINGS_NS = "dsh-codex"
    const CODEX_SETTINGS_PATH = Object.freeze([])
    const STYLE_ID = "dsh-codex-community/authorization-settings.css"
    const STYLE_REF_KEY = Symbol.for(`${STYLE_ID}/references`)

    const zh = {
      nav: "OpenAI Codex",
      title: "OpenAI Codex",
      description: "使用 ChatGPT 订阅在 dsh 中调用 Codex 模型，无需 API Key。",
      loading: "正在读取登录状态…",
      signedIn: "已登录",
      signedOut: "尚未登录",
      credentialInvalid: "凭据无效",
      credentialInvalidHelp: "已保存的 Codex 凭据无法使用；请重新登录，或退出后再登录。",
      inProgress: "登录正在进行",
      unavailable: "当前环境没有可用的 Codex 登录流程。",
      writableNo: "当前凭据存储不可写。",
      refresh: "刷新",
      refreshing: "刷新中…",
      signIn: "登录",
      signInWithChatGPT: "使用 ChatGPT 登录",
      signInAgain: "重新登录",
      cancelling: "正在取消登录",
      cancel: "取消登录",
      signOut: "退出登录",
      signingOut: "正在退出登录",
      confirmSignOut: "确认退出 Codex 登录并删除已保存的授权凭据吗？",
      openPage: "打开授权页面",
      deviceCode: "验证码",
      submit: "继续",
      decline: "取消",
      authorized: "登录成功。",
      cancelled: "登录已取消。",
      commitInProgress: "凭据已开始提交，当前无法取消；登录完成后状态会自动更新。",
      failed: "登录失败，请重试。",
      cancelFailed: "取消登录失败，请重试。",
      logoutFailed: "退出登录失败，请重试。",
      responseFailed: "提交登录信息失败，请重试。",
      requestFailed: "暂时无法连接本机授权服务。",
      locale: "zh-CN",
      quotaTitle: "使用额度",
      quotaProduct: "Codex",
      quotaLoading: "正在读取账户额度…",
      quotaLoadFailed: "暂时无法刷新账户额度。",
      quotaStaleHelp: "继续显示上一次验证成功的数据。",
      quotaUnknown: "尚无可验证的额度数据。",
      quotaUnknownHelp: "登录后会在每次进入此页面和手动刷新时读取；读取失败时保留最近的安全观测。",
      quotaFiveHour: "5 小时额度",
      quotaWeekly: "每周额度",
      quotaMinuteWindow: "分钟额度",
      quotaRemaining: "剩余",
      quotaResetsAt: "重置时间",
      quotaUpdatedAt: "数据更新时间",
      quotaResetSoon: "即将重置",
      quotaResetPrefix: "",
      quotaResetSuffix: "后重置",
      quotaResetMinute: "分钟",
      quotaResetHour: "小时",
      quotaResetDay: "天",
      quotaRecentSuccess: "最近一次 Codex 请求成功",
      quotaSuccessCaution: "这只表示最近一次请求成功，不代表账户剩余额度。",
      quotaExhausted: "最近观测到 Codex 账户额度已用尽。",
      quotaObservedAt: "观测时间",
      quotaResetAt: "观测到的重置时间",
      quotaNoReset: "未获得通过校验的重置时间；状态会在有限时间后自动回到未知。",
      modelsTitle: "当前安装的 Codex 模型",
      modelsDescription: "选择在模型选择器中显示的 Codex 模型。名称、上下文和最大输出来自当前安装的 provider catalog；隐藏模型不影响已有会话。",
      modelsContextWindow: "上下文",
      modelsMaxOutput: "最大输出",
      modelsLoading: "正在读取 Codex 模型目录…",
      modelsUnavailable: "当前环境没有可用的 Codex 模型管理接口。",
      modelsReadOnly: "当前设置存储为只读，无法修改启用模型。",
      modelsEmpty: "当前安装没有可管理的 Codex 模型。",
      modelsSave: "保存启用模型",
      modelsSaving: "正在保存…",
      modelsSaved: "模型启用设置已保存。",
      modelsAtLeastOne: "至少需要启用一个 Codex 模型。",
      modelsAllEnabledFollow: "已启用全部当前目录模型；保存后将清除列表覆盖，未来新增模型会自动显示。",
      modelsAllEnabledPreserve: "已启用全部当前目录模型；为保留其他模型参数，保存后会固定当前列表，未来新增模型不会自动显示。",
      modelsShowMore: "显示未选择的 {count} 个模型",
      modelsCollapse: "收起未选择的模型",
      modelsSummary: "已选择 {selected}/{total} · 当前显示 {visible}/{total}",
      modelsRetry: "重新读取",
      modelsLoadFailed: "读取 Codex 模型目录失败。",
      modelsSaveFailed: "保存模型启用设置失败。",
      fastEnable: "启用 Fast（1.5×）",
      fastDisable: "关闭 Fast，恢复默认速度",
      fastUnsupported: "当前模型不支持 Fast（1.5×）",
      fastLoading: "正在读取 Fast 状态",
      fastUnavailable: "暂时无法读取 Fast 状态，点击重试",
      transportLabel: "传输方式：{transport}",
      transportLoading: "正在读取传输方式",
      transportUnavailable: "暂时无法读取传输方式，点击重试",
      transportMenu: "当前会话的传输方式",
      transportAuto: "自动",
      transportAutoHelp: "由 provider 自动选择合适的传输方式",
      transportSse: "SSE",
      transportSseHelp: "使用服务器发送事件传输响应",
      transportWebsocket: "WebSocket",
      transportWebsocketHelp: "使用实时 WebSocket 连接",
      transportWebsocketCached: "WebSocket 缓存",
      transportWebsocketCachedHelp: "复用当前会话的 WebSocket 缓存",
      transportSessionOnly: "仅应用于当前会话",
      transportReset: "恢复自动",
      transportResetLabel: "将当前会话的传输方式恢复为自动",
      diagnosticsTitle: "连接诊断",
      diagnosticsCollapsedHelp: "按需检查，不会自动运行",
      diagnosticsExpandedHelp: "诊断只返回安全状态，不显示凭据或原始错误。",
      diagnosticsLocal: "检查本机",
      diagnosticsLocalRunning: "正在检查本机…",
      diagnosticsLocalHelp: "不联网、不刷新凭据、不发送模型请求。",
      diagnosticsAccount: "检查账号",
      diagnosticsAccountRunning: "正在检查账号…",
      diagnosticsAccountHelp: "读取已有额度，必要时刷新 OAuth；不发送模型请求，也不消耗额度。",
      diagnosticsCancel: "取消",
      diagnosticsFailed: "诊断暂时不可用，请重试。",
      diagnosticsOutcomePass: "检查通过",
      diagnosticsOutcomeWarning: "检查完成，有提示",
      diagnosticsOutcomeFail: "检查未通过",
      diagnosticsOutcomeCancelled: "检查已取消",
      diagnosticsStatusPass: "通过",
      diagnosticsStatusWarning: "提示",
      diagnosticsStatusFail: "未通过",
      diagnosticsStatusSkipped: "已跳过",
      diagnosticsCheckRuntime: "运行环境",
      diagnosticsCheckCredential: "授权凭据",
      diagnosticsCheckModels: "模型目录",
      diagnosticsCheckAccountUsage: "账号额度",
      diagnosticsObservedAt: "检查时间",
      legacyReasoningRepair: "修复并设为新会话默认模型",
      legacyReasoningRepairing: "正在修复…",
      legacyReasoningRepaired: "已修复并设为新会话默认模型",
      legacyReasoningRepairRetry: "重试修复并设为新会话默认模型",
      legacyReasoningRepairHelp: "旧会话保存了当前不支持的 Off/Minimal。点击后会切换到此模型当前默认档位；与模型选择器相同，此操作也会把该模型保存为未来新会话的默认模型。",
    }
    const en = {
      nav: "OpenAI Codex",
      title: "OpenAI Codex",
      description: "Use your ChatGPT subscription to access Codex models in dsh—no API key required.",
      loading: "Reading sign-in status…",
      signedIn: "Signed in",
      signedOut: "Not signed in",
      credentialInvalid: "Invalid credential",
      credentialInvalidHelp: "The saved Codex credential cannot be used. Sign in again, or sign out and then sign in.",
      inProgress: "Sign-in in progress",
      unavailable: "No Codex sign-in flow is available in this environment.",
      writableNo: "The credential store is currently read-only.",
      refresh: "Refresh",
      refreshing: "Refreshing…",
      signIn: "Sign in",
      signInWithChatGPT: "Sign in with ChatGPT",
      signInAgain: "Sign in again",
      cancelling: "Cancelling sign-in",
      cancel: "Cancel sign-in",
      signOut: "Sign out",
      signingOut: "Signing out",
      confirmSignOut: "Sign out of Codex and delete the saved authorization credential?",
      openPage: "Open authorization page",
      deviceCode: "Verification code",
      submit: "Continue",
      decline: "Cancel",
      authorized: "Sign-in complete.",
      cancelled: "Sign-in cancelled.",
      commitInProgress: "Credential commit has started and can no longer be cancelled. Status will update when sign-in completes.",
      failed: "Sign-in failed. Please try again.",
      cancelFailed: "Could not cancel sign-in. Please try again.",
      logoutFailed: "Could not sign out. Please try again.",
      responseFailed: "Could not submit the sign-in response. Please try again.",
      requestFailed: "The local authorization service is temporarily unavailable.",
      locale: "en-US",
      quotaTitle: "Usage",
      quotaProduct: "Codex",
      quotaLoading: "Reading account usage…",
      quotaLoadFailed: "Account usage could not be refreshed.",
      quotaStaleHelp: "The last successfully verified data remains visible.",
      quotaUnknown: "No verifiable usage data is available yet.",
      quotaUnknownHelp: "After sign-in, usage is read whenever this page opens and when you refresh it; the latest safe observation remains available if the read fails.",
      quotaFiveHour: "5-hour limit",
      quotaWeekly: "Weekly limit",
      quotaMinuteWindow: "minute limit",
      quotaRemaining: "Remaining",
      quotaResetsAt: "Resets",
      quotaUpdatedAt: "Data updated",
      quotaResetSoon: "Resets soon",
      quotaResetPrefix: "Resets in",
      quotaResetSuffix: "",
      quotaResetMinute: "minute",
      quotaResetHour: "hour",
      quotaResetDay: "day",
      quotaRecentSuccess: "The latest Codex request succeeded",
      quotaSuccessCaution: "This only describes the latest request; it does not represent remaining account quota.",
      quotaExhausted: "Codex account quota was exhausted in the latest observation.",
      quotaObservedAt: "Observed at",
      quotaResetAt: "Observed reset time",
      quotaNoReset: "No reset time passed validation; this state automatically returns to unknown after a bounded interval.",
      modelsTitle: "Codex models in this installation",
      modelsDescription: "Choose which Codex models appear in the model selector. Names, context windows, and maximum output values come from the installed provider catalog; hidden models do not affect existing conversations.",
      modelsContextWindow: "Context",
      modelsMaxOutput: "Max output",
      modelsLoading: "Reading the Codex model catalog…",
      modelsUnavailable: "Codex model management is unavailable in this environment.",
      modelsReadOnly: "The settings store is read-only, so enabled models cannot be changed.",
      modelsEmpty: "This installation has no Codex models to manage.",
      modelsSave: "Save enabled models",
      modelsSaving: "Saving…",
      modelsSaved: "Enabled models saved.",
      modelsAtLeastOne: "At least one Codex model must remain enabled.",
      modelsAllEnabledFollow: "All current catalog models are enabled. Saving clears the list override, so future models appear automatically.",
      modelsAllEnabledPreserve: "All current catalog models are enabled. To preserve other model settings, saving fixes the current list and future models will not appear automatically.",
      modelsShowMore: "Show {count} unselected models",
      modelsCollapse: "Hide unselected models",
      modelsSummary: "Selected {selected}/{total} · Showing {visible}/{total}",
      modelsRetry: "Reload",
      modelsLoadFailed: "Could not read the Codex model catalog.",
      modelsSaveFailed: "Could not save the enabled models.",
      fastEnable: "Enable Fast (1.5×)",
      fastDisable: "Turn off Fast and restore standard speed",
      fastUnsupported: "The current model does not support Fast (1.5×)",
      fastLoading: "Reading Fast status",
      fastUnavailable: "Fast status is temporarily unavailable; click to retry",
      transportLabel: "Transport: {transport}",
      transportLoading: "Reading transport",
      transportUnavailable: "Transport is temporarily unavailable; click to retry",
      transportMenu: "Transport for this conversation",
      transportAuto: "Auto",
      transportAutoHelp: "Let the provider select the appropriate transport",
      transportSse: "SSE",
      transportSseHelp: "Stream responses with Server-Sent Events",
      transportWebsocket: "WebSocket",
      transportWebsocketHelp: "Use a live WebSocket connection",
      transportWebsocketCached: "Cached WebSocket",
      transportWebsocketCachedHelp: "Reuse the WebSocket cache for this conversation",
      transportSessionOnly: "Applies only to this conversation",
      transportReset: "Reset to Auto",
      transportResetLabel: "Reset this conversation's transport to Auto",
      diagnosticsTitle: "Connection diagnostics",
      diagnosticsCollapsedHelp: "Runs only when requested; never starts automatically",
      diagnosticsExpandedHelp: "Diagnostics return safe status only, without credentials or raw errors.",
      diagnosticsLocal: "Check this device",
      diagnosticsLocalRunning: "Checking this device…",
      diagnosticsLocalHelp: "No network access, credential refresh, or model request.",
      diagnosticsAccount: "Check account",
      diagnosticsAccountRunning: "Checking account…",
      diagnosticsAccountHelp: "Reads existing usage and refreshes OAuth only when needed; never sends a model request or consumes usage.",
      diagnosticsCancel: "Cancel",
      diagnosticsFailed: "Diagnostics are temporarily unavailable. Try again.",
      diagnosticsOutcomePass: "Checks passed",
      diagnosticsOutcomeWarning: "Checks completed with notes",
      diagnosticsOutcomeFail: "Checks did not pass",
      diagnosticsOutcomeCancelled: "Checks cancelled",
      diagnosticsStatusPass: "Passed",
      diagnosticsStatusWarning: "Note",
      diagnosticsStatusFail: "Failed",
      diagnosticsStatusSkipped: "Skipped",
      diagnosticsCheckRuntime: "Runtime",
      diagnosticsCheckCredential: "Credential",
      diagnosticsCheckModels: "Model catalog",
      diagnosticsCheckAccountUsage: "Account usage",
      diagnosticsObservedAt: "Checked",
      legacyReasoningRepair: "Repair and set as future default",
      legacyReasoningRepairing: "Repairing…",
      legacyReasoningRepaired: "Repaired and set as future default",
      legacyReasoningRepairRetry: "Retry repair and set as future default",
      legacyReasoningRepairHelp: "This conversation saved an unsupported Off/Minimal level. Click to switch to this model's current default. Like using the model selector, this also saves it as the default model for future conversations.",
    }

    const NAV_ICON_MARKER = "data-dsh-codex-community-nav-icon"
    const NAV_ICON_STYLE_SELECTOR = 'style[data-plugin-nav-icon="dsh-codex-community"]'
    const NAV_ICON_STATE_KEY = Symbol.for("dsh-codex-community.settings-nav-icon.v1")
    const NAV_ICON_LABELS = new Set([zh.nav.trim(), en.nav.trim()])
    const SETTINGS_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]'
    const SETTINGS_NAV_SELECTOR = `${SETTINGS_DIALOG_SELECTOR} > nav`
    const SETTINGS_NAV_BUTTON_SELECTOR = `${SETTINGS_NAV_SELECTOR} button`
    // settings.section has no icon slot in Harness 0.1.1-rc.2. This original code-brackets glyph is applied only to the unique Codex nav entry.
    const CODE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <path d="M5.25 3.25 1.5 8l3.75 4.75M10.75 3.25 14.5 8l-3.75 4.75M9.25 2.5l-2.5 11" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
    const CODE_ICON_MASK = `data:image/svg+xml,${encodeURIComponent(CODE_ICON_SVG).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`
    const NAV_ICON_CSS = [
      `[${NAV_ICON_MARKER}]>svg:first-child{display:none!important}`,
      `[${NAV_ICON_MARKER}]::before{content:"";width:16px;height:16px;flex:none;background:currentColor;-webkit-mask:url("${CODE_ICON_MASK}") center/contain no-repeat;mask:url("${CODE_ICON_MASK}") center/contain no-repeat}`,
    ].join("")

    function createAuthorizationClient(connection) {
      const call = async (endpoint, payload, signal) => {
        const result = await connection.rpc.call(CHANNEL, endpoint, payload, signal)
        if (!result.ok) {
          const error = new Error(result.error.message)
          error.code = result.error.code
          throw error
        }
        return result.value
      }
      return Object.freeze({
        describe: (signal) => call("status", {}, signal),
        watch: (attemptId, after, signal) => call("status", { attemptId, after }, signal),
        start: (method) => call("start", method === undefined ? {} : { method }),
        answer: (attemptId, promptId, value) => call("respond", {
          attemptId,
          promptId,
          action: "answer",
          value,
        }),
        decline: (attemptId, promptId) => call("respond", {
          attemptId,
          promptId,
          action: "decline",
        }),
        cancel: (attemptId) => call("cancel", attemptId === undefined ? {} : { attemptId }),
        logout: () => call("logout", {}),
        usage: (signal) => call("usage", {}, signal),
      })
    }

    const DIAGNOSTIC_MODES = new Set(["local", "account"])
    const DIAGNOSTIC_OUTCOMES = new Set(["pass", "warning", "fail", "cancelled"])
    const DIAGNOSTIC_CHECK_IDS = Object.freeze({
      local: Object.freeze(["runtime", "credential", "models"]),
      account: Object.freeze(["runtime", "credential", "models", "account-usage"]),
    })
    const DIAGNOSTIC_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u
    const DIAGNOSTIC_CHECK_CONTRACTS = Object.freeze({
      runtime: Object.freeze({
        cancelled: diagnosticCheckContract("skipped"),
        "runtime-ready": diagnosticCheckContract("pass", ["route", "registered"]),
        "route-unavailable": diagnosticCheckContract("fail", ["route", "registered"]),
        "runtime-unavailable": diagnosticCheckContract("fail"),
      }),
      credential: Object.freeze({
        cancelled: diagnosticCheckContract("skipped"),
        "credential-invalid": diagnosticCheckContract("fail", ["configured", "state", "writable"]),
        "credential-signed-out": diagnosticCheckContract("warning", ["configured", "state", "writable"]),
        "credential-read-only": diagnosticCheckContract("warning", ["configured", "state", "writable"]),
        "credential-ready": diagnosticCheckContract("pass", ["configured", "state", "writable"]),
        "credential-unavailable": diagnosticCheckContract("fail"),
      }),
      models: Object.freeze({
        cancelled: diagnosticCheckContract("skipped"),
        "models-unavailable": diagnosticCheckContract("fail"),
        "catalog-empty": diagnosticCheckContract("fail", ["catalogCount", "enabledCount", "selection", "allEnabled"]),
        "models-disabled": diagnosticCheckContract("warning", ["catalogCount", "enabledCount", "selection", "allEnabled"]),
        "models-ready": diagnosticCheckContract("pass", ["catalogCount", "enabledCount", "selection", "allEnabled"]),
      }),
      "account-usage": Object.freeze({
        cancelled: diagnosticCheckContract("skipped"),
        "account-usage-invalid": diagnosticCheckContract("fail"),
        "account-usage-empty": diagnosticCheckContract("warning", ["rateLimitCount", "primaryWindows", "secondaryWindows"]),
        "account-usage-ready": diagnosticCheckContract("pass", ["rateLimitCount", "primaryWindows", "secondaryWindows"]),
        "account-auth-unavailable": diagnosticCheckContract("fail"),
        "account-network-unavailable": diagnosticCheckContract("fail"),
        "account-timeout": diagnosticCheckContract("fail"),
        "account-http-error": diagnosticCheckContract("fail"),
        "account-response-invalid": diagnosticCheckContract("fail"),
        "account-usage-unavailable": diagnosticCheckContract("fail"),
      }),
    })
    const DIAGNOSTIC_FACT_SCHEMAS = Object.freeze({
      runtime: Object.freeze({
        route: (value) => value === "dsh-codex",
        registered: (value) => typeof value === "boolean",
      }),
      credential: Object.freeze({
        configured: (value) => typeof value === "boolean",
        state: (value) => value === "signed-in" || value === "signed-out" || value === "invalid",
        writable: (value) => typeof value === "boolean",
      }),
      models: Object.freeze({
        catalogCount: diagnosticCount,
        enabledCount: diagnosticCount,
        selection: (value) => value === "all" || value === "custom",
        allEnabled: (value) => typeof value === "boolean",
      }),
      "account-usage": Object.freeze({
        rateLimitCount: diagnosticCount,
        primaryWindows: diagnosticCount,
        secondaryWindows: diagnosticCount,
      }),
    })

    function invalidDiagnosticsResponse() {
      const error = new Error("Invalid connection diagnostics response.")
      error.code = "INVALID_DIAGNOSTICS_RESPONSE"
      return error
    }

    function diagnosticCount(value) {
      return Number.isSafeInteger(value) && value >= 0
    }

    function diagnosticCheckContract(status, facts) {
      return Object.freeze({
        status,
        facts: facts === undefined ? null : Object.freeze([...facts]),
      })
    }

    function safeDiagnosticFacts(checkId, value, expectedKeys) {
      if (expectedKeys === null) {
        if (value !== undefined) throw invalidDiagnosticsResponse()
        return undefined
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw invalidDiagnosticsResponse()
      }
      const schema = DIAGNOSTIC_FACT_SCHEMAS[checkId]
      if (schema === undefined) throw invalidDiagnosticsResponse()
      const keys = Reflect.ownKeys(value)
      if (keys.length !== expectedKeys.length
        || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
        throw invalidDiagnosticsResponse()
      }
      const facts = {}
      for (const key of expectedKeys) {
        const fact = value[key]
        if (typeof schema[key] !== "function" || !schema[key](fact)) throw invalidDiagnosticsResponse()
        facts[key] = fact
      }
      return Object.freeze(facts)
    }

    function diagnosticsOutcomeFor(checks) {
      if (checks.some(({ status }) => status === "skipped")) return "cancelled"
      if (checks.some(({ status }) => status === "fail")) return "fail"
      if (checks.some(({ status }) => status === "warning")) return "warning"
      return "pass"
    }

    function safeDiagnosticsReport(value, expectedMode) {
      if (value === null || typeof value !== "object" || Array.isArray(value)
        || value.version !== 1
        || value.mode !== expectedMode
        || !DIAGNOSTIC_OUTCOMES.has(value.outcome)
        || !Number.isSafeInteger(value.observedAt)
        || value.observedAt < 0
        || !Array.isArray(value.checks)
        || value.checks.length !== DIAGNOSTIC_CHECK_IDS[expectedMode].length) {
        throw invalidDiagnosticsResponse()
      }
      const checks = Array.from(value.checks, (check, index) => {
        const contract = DIAGNOSTIC_CHECK_CONTRACTS[check?.id]?.[check?.code]
        if (check === null || typeof check !== "object" || Array.isArray(check)
          || check.id !== DIAGNOSTIC_CHECK_IDS[expectedMode][index]
          || typeof check.code !== "string"
          || !DIAGNOSTIC_CODE_PATTERN.test(check.code)
          || contract === undefined
          || check.status !== contract.status) {
          throw invalidDiagnosticsResponse()
        }
        const facts = safeDiagnosticFacts(check.id, check.facts, contract.facts)
        return Object.freeze({
          id: check.id,
          status: check.status,
          code: check.code,
          ...(facts === undefined ? {} : { facts }),
        })
      })
      if (value.outcome !== diagnosticsOutcomeFor(checks)) throw invalidDiagnosticsResponse()
      return Object.freeze({
        version: 1,
        mode: value.mode,
        outcome: value.outcome,
        observedAt: value.observedAt,
        checks: Object.freeze(checks),
      })
    }

    function createConnectionDiagnosticsClient(connection) {
      return Object.freeze({
        async run(mode, signal) {
          if (!DIAGNOSTIC_MODES.has(mode)) throw new TypeError("Unsupported diagnostics mode.")
          const result = await connection.rpc.call(
            DIAGNOSTICS_CHANNEL,
            "run",
            { mode },
            signal,
          )
          if (!result.ok) {
            const error = new Error("Connection diagnostics failed.")
            error.code = typeof result.error?.code === "string"
              && DIAGNOSTIC_CODE_PATTERN.test(result.error.code)
              ? result.error.code
              : "DIAGNOSTICS_FAILED"
            throw error
          }
          return safeDiagnosticsReport(result.value, mode)
        },
      })
    }

    function createSessionPreferenceClient(connection) {
      const call = async (endpoint, payload, signal) => {
        const result = await connection.rpc.call(SESSION_CHANNEL, endpoint, payload, signal)
        if (!result.ok) {
          const error = new Error(result.error.message)
          error.code = result.error.code
          throw error
        }
        return result.value
      }
      return Object.freeze({
        forSession(sessionId) {
          return Object.freeze({
            get: (signal) => call("get", { sessionId }, signal),
            getForModel: (modelId, signal) => call("get", { sessionId, modelId }, signal),
            setFast: (fast, signal) => call("set-fast", { sessionId, fast }, signal),
            setTransport: (transport, signal) => call("set-transport", {
              sessionId,
              transport,
            }, signal),
          })
        },
      })
    }

    const TRANSPORT_OPTIONS = Object.freeze([
      Object.freeze({ id: "auto", label: "transportAuto", help: "transportAutoHelp" }),
      Object.freeze({ id: "sse", label: "transportSse", help: "transportSseHelp" }),
      Object.freeze({ id: "websocket", label: "transportWebsocket", help: "transportWebsocketHelp" }),
      Object.freeze({
        id: "websocket-cached",
        label: "transportWebsocketCached",
        help: "transportWebsocketCachedHelp",
      }),
    ])
    const TRANSPORT_IDS = new Set(TRANSPORT_OPTIONS.map(({ id }) => id))

    function readyPreference(value, previous) {
      return {
        status: "ready",
        fast: value?.fast === true,
        transport: TRANSPORT_IDS.has(value?.transport) ? value.transport : previous.transport,
        fastSupported: typeof value?.fastSupported === "boolean"
          ? value.fastSupported
          : previous.fastSupported,
      }
    }

    function CodexFastToggle({
      session,
      useModelDirectory,
      preferenceClient,
      selectModel,
      t,
    }) {
      const current = useModelDirectory((state) => state.current ?? null)
      const [preference, setPreference] = React.useState({
        status: "loading",
        fast: false,
        transport: "auto",
        fastSupported: null,
      })
      const [transportMenuOpen, setTransportMenuOpen] = React.useState(false)
      const [activeTransportIndex, setActiveTransportIndex] = React.useState(0)
      const [repair, setRepair] = React.useState({ key: null, status: "idle" })
      const mountedRef = React.useRef(false)
      const generationRef = React.useRef(0)
      const controllerRef = React.useRef(null)
      const repairAttemptRef = React.useRef(null)
      const transportControlRef = React.useRef(null)
      const transportButtonRef = React.useRef(null)
      const transportOptionRefs = React.useRef([])
      const transportInstanceId = React.useId().replace(/[^a-zA-Z0-9_-]/gu, "")
      const transportMenuId = `dsh-codex-transport-menu-${transportInstanceId}`
      const isCodex = current?.provider === CODEX_PROVIDER
      const supported = isCodex && preference.fastSupported === true

      const refreshPreference = React.useCallback(async () => {
        if (!mountedRef.current || !isCodex) return
        const generation = ++generationRef.current
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        setPreference((value) => ({ ...value, status: "loading" }))
        try {
          const value = await preferenceClient.getForModel(current.model, controller.signal)
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference((previous) => readyPreference(value, previous))
        } catch {
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference((value) => ({ ...value, status: "error" }))
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      }, [current?.model, isCodex, preferenceClient])

      React.useEffect(() => {
        mountedRef.current = true
        if (isCodex) void refreshPreference()
        return () => {
          mountedRef.current = false
          generationRef.current += 1
          controllerRef.current?.abort()
          controllerRef.current = null
        }
      }, [isCodex, preferenceClient, refreshPreference])

      React.useEffect(() => {
        if (!transportMenuOpen) return undefined
        transportOptionRefs.current[activeTransportIndex]?.focus?.()
        return undefined
      }, [activeTransportIndex, transportMenuOpen])

      React.useEffect(() => {
        if (
          !transportMenuOpen
          || typeof document === "undefined"
          || typeof document.addEventListener !== "function"
        ) return undefined
        const dismiss = (event) => {
          if (transportControlRef.current?.contains?.(event.target) === true) return
          setTransportMenuOpen(false)
        }
        document.addEventListener("pointerdown", dismiss)
        return () => document.removeEventListener?.("pointerdown", dismiss)
      }, [transportMenuOpen])

      const legacySelection = isCodex
        && (current?.reasoningEffort === "off" || current?.reasoningEffort === "minimal")
      const legacyKey = legacySelection ? `${current.model}:${current.reasoningEffort}` : null
      const repairStatus = repair.key === legacyKey ? repair.status : "idle"

      const repairLegacySelection = async () => {
        if (
          !mountedRef.current
          || !legacySelection
          || typeof selectModel !== "function"
          || session?.removed === true
          || repairStatus === "saving"
          || repairStatus === "done"
          || repairAttemptRef.current === legacyKey
        ) return
        const key = legacyKey
        repairAttemptRef.current = key
        setRepair({ key, status: "saving" })
        try {
          await selectModel({
            provider: CODEX_PROVIDER,
            model: current.model,
          })
          if (mountedRef.current) setRepair({ key, status: "done" })
        } catch {
          if (repairAttemptRef.current === key) repairAttemptRef.current = null
          if (mountedRef.current) setRepair({ key, status: "error" })
        }
      }

      const toggleFast = async () => {
        if (!mountedRef.current || session?.removed === true) return
        if (preference.status === "error") {
          void refreshPreference()
          return
        }
        if (!supported) return
        if (preference.status !== "ready") return
        const generation = ++generationRef.current
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        const nextFast = !preference.fast
        setPreference((value) => ({ ...value, status: "saving" }))
        try {
          const value = await preferenceClient.setFast(nextFast, controller.signal)
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference((previous) => readyPreference(value, previous))
        } catch {
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference((value) => ({ ...value, status: "error" }))
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      }

      const closeTransportMenu = (returnFocus = false) => {
        setTransportMenuOpen(false)
        if (returnFocus) transportButtonRef.current?.focus?.()
      }

      const openTransportMenu = () => {
        if (session?.removed === true) return
        if (preference.status === "error") {
          void refreshPreference()
          return
        }
        if (preference.status !== "ready") return
        const selectedIndex = TRANSPORT_OPTIONS.findIndex(({ id }) => id === preference.transport)
        setActiveTransportIndex(selectedIndex < 0 ? 0 : selectedIndex)
        setTransportMenuOpen(true)
      }

      const chooseTransport = async (transport) => {
        if (
          !mountedRef.current
          || !TRANSPORT_IDS.has(transport)
          || session?.removed === true
          || preference.status !== "ready"
        ) return
        closeTransportMenu(true)
        if (transport === preference.transport) return
        const generation = ++generationRef.current
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        setPreference((value) => ({ ...value, status: "saving" }))
        try {
          const value = await preferenceClient.setTransport(transport, controller.signal)
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference((previous) => readyPreference(value, previous))
        } catch {
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference((value) => ({ ...value, status: "error" }))
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      }

      const handleTransportButtonKeyDown = (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        event.preventDefault()
        openTransportMenu()
      }

      const handleTransportMenuKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          closeTransportMenu(true)
          return
        }
        let nextIndex
        if (event.key === "ArrowDown") {
          nextIndex = (activeTransportIndex + 1) % TRANSPORT_OPTIONS.length
        } else if (event.key === "ArrowUp") {
          nextIndex = (activeTransportIndex - 1 + TRANSPORT_OPTIONS.length) % TRANSPORT_OPTIONS.length
        } else if (event.key === "Home") {
          nextIndex = 0
        } else if (event.key === "End") {
          nextIndex = TRANSPORT_OPTIONS.length - 1
        } else {
          return
        }
        event.preventDefault()
        setActiveTransportIndex(nextIndex)
      }

      if (!isCodex) return null
      const label = preference.status === "loading" || preference.status === "saving"
          ? t("fastLoading")
          : preference.status === "error"
            ? t("fastUnavailable")
            : !supported
              ? t("fastUnsupported")
              : preference.fast
                ? t("fastDisable")
                : t("fastEnable")
      const disabled = session?.removed === true
        || preference.status === "loading"
        || preference.status === "saving"
        || (preference.status === "ready" && !supported)

      const fastButton = h("button", {
        type: "button",
        className: "dshCodexFastToggle",
        "data-fast": preference.fast ? "true" : undefined,
        "aria-label": label,
        "aria-pressed": preference.fast,
        "aria-busy": preference.status === "loading" || preference.status === "saving" ? "true" : undefined,
        title: label,
        disabled,
        onClick: () => void toggleFast(),
      }, h("svg", {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      }, h("path", { d: "M13 2 4.5 13h7L11 22l8.5-11h-7L13 2Z" })))

      const transportName = t(TRANSPORT_OPTIONS.find(({ id }) => id === preference.transport)?.label
        ?? "transportAuto")
      const transportLabel = preference.status === "loading" || preference.status === "saving"
        ? t("transportLoading")
        : preference.status === "error"
          ? t("transportUnavailable")
          : t("transportLabel").replace("{transport}", transportName)
      const transportDisabled = session?.removed === true
        || preference.status === "loading"
        || preference.status === "saving"
      const transportButton = h("button", {
        type: "button",
        ref: transportButtonRef,
        className: "dshCodexTransportToggle",
        "data-transport": preference.transport,
        "aria-label": transportLabel,
        "aria-haspopup": "menu",
        "aria-expanded": transportMenuOpen ? "true" : "false",
        "aria-controls": transportMenuOpen ? transportMenuId : undefined,
        "aria-busy": preference.status === "loading" || preference.status === "saving" ? "true" : undefined,
        title: transportLabel,
        disabled: transportDisabled,
        onClick: () => transportMenuOpen ? closeTransportMenu() : openTransportMenu(),
        onKeyDown: handleTransportButtonKeyDown,
      }, h("svg", {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      },
      h("path", { d: "M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3" })))

      const transportMenu = !transportMenuOpen ? null : h("div", {
        id: transportMenuId,
        className: "dshCodexTransportMenu",
        role: "menu",
        "aria-label": t("transportMenu"),
        "aria-orientation": "vertical",
        onKeyDown: handleTransportMenuKeyDown,
      },
      ...TRANSPORT_OPTIONS.map((option, index) => h("button", {
        key: option.id,
        type: "button",
        ref: (element) => { transportOptionRefs.current[index] = element },
        className: "dshCodexTransportOption",
        role: "menuitemradio",
        "aria-checked": preference.transport === option.id,
        "data-selected": preference.transport === option.id ? "true" : undefined,
        tabIndex: activeTransportIndex === index ? 0 : -1,
        onMouseEnter: () => setActiveTransportIndex(index),
        onClick: () => void chooseTransport(option.id),
      },
      h("span", { className: "dshCodexTransportOptionCopy" },
        h("strong", null, t(option.label)),
        h("span", null, t(option.help))),
      preference.transport === option.id
        ? h("svg", {
            viewBox: "0 0 24 24",
            width: 16,
            height: 16,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2.2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
          }, h("path", { d: "m5 12 4 4L19 6" }))
        : null)),
      h("div", { className: "dshCodexTransportMenuFooter", role: "none" },
        h("span", null, t("transportSessionOnly")),
        h("button", {
          type: "button",
          className: "dshCodexTransportReset",
          role: "menuitem",
          disabled: preference.transport === "auto",
          "aria-label": t("transportResetLabel"),
          onClick: () => void chooseTransport("auto"),
        }, t("transportReset"))))

      const transportControl = h("div", {
        className: "dshCodexTransportControl",
        ref: transportControlRef,
        onBlur: (event) => {
          if (event.currentTarget?.contains?.(event.relatedTarget) === true) return
          closeTransportMenu()
        },
      }, transportButton, transportMenu)

      if (!legacySelection || typeof selectModel !== "function") {
        return h(React.Fragment, null, fastButton, transportControl)
      }
      const repairLabel = repairStatus === "saving"
        ? t("legacyReasoningRepairing")
        : repairStatus === "done"
          ? t("legacyReasoningRepaired")
          : repairStatus === "error"
            ? t("legacyReasoningRepairRetry")
            : t("legacyReasoningRepair")
      return h(React.Fragment, null,
        h("button", {
          type: "button",
          className: "dshCodexLegacyRepair",
          "data-status": repairStatus,
          "aria-label": repairLabel,
          "aria-busy": repairStatus === "saving" ? "true" : undefined,
          title: t("legacyReasoningRepairHelp"),
          disabled: session?.removed === true || repairStatus === "saving" || repairStatus === "done",
          onClick: () => void repairLegacySelection(),
        }, repairLabel),
        fastButton,
        transportControl)
    }

    function resultValue(response) {
      if (response?.result?.ok === true) return response.result.value
      const message = response?.result?.error?.message
      throw new Error(typeof message === "string" && message.length > 0 ? message : "DSH API request failed")
    }

    function safeQuotaSnapshot(value, now = Date.now()) {
      if (typeof value !== "object" || value === null || !Number.isSafeInteger(now) || now < 0) {
        return { status: "unknown" }
      }
      if (value.status === "recent-success" && Number.isSafeInteger(value.observedAt) && value.observedAt >= 0) {
        return { status: value.status, observedAt: value.observedAt }
      }
      if (value.status !== "exhausted" || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0) {
        return { status: "unknown" }
      }
      if (value.resetAt === undefined) return { status: value.status, observedAt: value.observedAt }
      if (!Number.isSafeInteger(value.resetAt) || value.resetAt <= now || !Number.isFinite(new Date(value.resetAt).getTime())) {
        return { status: "unknown" }
      }
      return {
        status: value.status,
        observedAt: value.observedAt,
        resetAt: value.resetAt,
        remainingMinutes: Math.max(1, Math.ceil((value.resetAt - now) / 60_000)),
      }
    }

    function safeAccountUsage(value) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
      if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0) return undefined
      if (!Array.isArray(value.rateLimits) || value.rateLimits.length > 16) return undefined
      const rateLimits = []
      for (const candidate of value.rateLimits) {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue
        if (typeof candidate.limitId !== "string" || candidate.limitId.length < 1 || candidate.limitId.length > 128) continue
        const primary = safeUsageWindow(candidate.primary)
        const secondary = safeUsageWindow(candidate.secondary)
        if (primary === undefined && secondary === undefined) continue
        rateLimits.push({
          limitId: candidate.limitId,
          ...(typeof candidate.limitName === "string" && candidate.limitName.length > 0 && candidate.limitName.length <= 256
            ? { limitName: candidate.limitName }
            : {}),
          ...(primary === undefined ? {} : { primary }),
          ...(secondary === undefined ? {} : { secondary }),
        })
      }
      if (rateLimits.length === 0) return undefined
      return { observedAt: value.observedAt, rateLimits }
    }

    function safeUsageWindow(value) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
      if (typeof value.usedPercent !== "number" || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) return undefined
      if (!Number.isSafeInteger(value.windowDurationMins) || value.windowDurationMins < 1 || value.windowDurationMins > 525_600) return undefined
      if (!Number.isSafeInteger(value.resetsAt) || value.resetsAt < 0 || !Number.isFinite(new Date(value.resetsAt).getTime())) return undefined
      return {
        usedPercent: value.usedPercent,
        windowDurationMins: value.windowDurationMins,
        resetsAt: value.resetsAt,
      }
    }

    function percentText(value) {
      return String(Math.round(value * 10) / 10)
    }

    function usageWindowLabel(window, t) {
      if (window.windowDurationMins === 300) return t("quotaFiveHour")
      if (window.windowDurationMins === 10_080) return t("quotaWeekly")
      return `${window.windowDurationMins} ${t("quotaMinuteWindow")}`
    }

    function formatResetDistance(resetsAt, t, now = Date.now()) {
      if (!Number.isSafeInteger(resetsAt) || !Number.isSafeInteger(now) || resetsAt < 0 || now < 0) {
        return t("quotaResetSoon")
      }
      const remaining = resetsAt - now
      if (remaining <= 60_000) return t("quotaResetSoon")
      let count
      let unit
      if (remaining < 60 * 60_000) {
        count = Math.ceil(remaining / 60_000)
        unit = t("quotaResetMinute")
      } else if (remaining < 24 * 60 * 60_000) {
        count = Math.ceil(remaining / (60 * 60_000))
        unit = t("quotaResetHour")
      } else {
        count = Math.ceil(remaining / (24 * 60 * 60_000))
        unit = t("quotaResetDay")
      }
      if (t("locale").toLowerCase().startsWith("zh")) {
        return `${count} ${unit}${t("quotaResetSuffix")}`
      }
      return `${t("quotaResetPrefix")} ${count} ${unit}${count === 1 ? "" : "s"}`
    }

    function renderResetTime(resetsAt, t, { showExact = false, now = Date.now() } = {}) {
      const exact = new Date(resetsAt).toLocaleString(t("locale"))
      const relative = formatResetDistance(resetsAt, t, now)
      const separator = t("locale").toLowerCase().startsWith("zh") ? "：" : ": "
      const exactLabel = `${t("quotaResetsAt")}${separator}${exact}`
      return h("time", {
        dateTime: new Date(resetsAt).toISOString(),
        title: exactLabel,
        "aria-label": showExact ? exactLabel : `${relative} · ${exactLabel}`,
      }, showExact ? exactLabel : relative)
    }

    function refreshIcon() {
      return h("svg", {
        className: "dshCodexRefreshIcon",
        viewBox: "0 0 16 16",
        fill: "none",
        "aria-hidden": "true",
        focusable: "false",
      },
      h("path", {
        d: "M13.25 5.75A5.5 5.5 0 1 0 13.1 10.6",
        stroke: "currentColor",
        strokeWidth: "1.4",
        strokeLinecap: "round",
      }),
      h("path", {
        d: "M10.25 5.75h3v-3",
        stroke: "currentColor",
        strokeWidth: "1.4",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }))
    }

    function renderObservedQuota(quota, t) {
      if (quota.status === "recent-success") {
        return h(React.Fragment, null,
          h("p", { className: "dshCodexQuotaState" }, `${t("quotaRecentSuccess")} · ${new Date(quota.observedAt).toLocaleString(t("locale"))}`),
          h("p", { className: "dshCodexMuted" }, t("quotaSuccessCaution")))
      }
      if (quota.status === "exhausted") {
        return h(React.Fragment, null,
          h("p", { className: "dshCodexQuotaState dshCodexQuotaExhausted" }, t("quotaExhausted")),
          h("p", { className: "dshCodexMuted" }, `${t("quotaObservedAt")} · ${new Date(quota.observedAt).toLocaleString(t("locale"))}`),
          quota.resetAt === undefined
            ? h("p", { className: "dshCodexMuted" }, t("quotaNoReset"))
            : h("p", { className: "dshCodexMuted" },
                `${t("quotaResetAt")} · `,
                renderResetTime(quota.resetAt, t)))
      }
      return h(React.Fragment, null,
        h("p", { className: "dshCodexQuotaState dshCodexQuotaUnknown" }, t("quotaUnknown")),
        h("p", { className: "dshCodexMuted" }, t("quotaUnknownHelp")))
    }

    function renderAccountUsage(usage, t) {
      const now = Date.now()
      return h(React.Fragment, null,
        ...usage.rateLimits.map((limit) => {
          const windows = [limit.primary, limit.secondary].filter((window) => window !== undefined)
          const limitLabel = limit.limitId === "codex"
            ? t("quotaProduct")
            : limit.limitName ?? limit.limitId
          return h("section", { key: limit.limitId, className: "dshCodexQuotaGroup" },
            h("p", { className: "dshCodexQuotaProduct" }, limitLabel),
            h("div", { className: "dshCodexQuotaWindows" },
              ...windows.map((window) => {
                const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent))
                const remainingText = percentText(remaining)
                const label = usageWindowLabel(window, t)
                const resetDistance = window.resetsAt - now
                const showExactReset = window.windowDurationMins === 300
                  || (window.windowDurationMins === 10_080
                    && resetDistance > 0
                    && resetDistance < 24 * 60 * 60_000)
                return h("div", { key: `${limit.limitId}-${window.windowDurationMins}`, className: "dshCodexQuotaWindow" },
                  h("div", { className: "dshCodexQuotaWindowHeader" },
                    h("span", null, label),
                    h("strong", null, `${t("quotaRemaining")} ${remainingText}%`)),
                  h("progress", {
                    max: 100,
                    value: remaining,
                    "aria-label": `${limitLabel} · ${label} · ${t("quotaRemaining")} ${remainingText}%`,
                  }),
                  h("div", { className: "dshCodexQuotaMeta" },
                    renderResetTime(window.resetsAt, t, { showExact: showExactReset, now })))
              })))
        }),
        h("p", { className: "dshCodexMuted dshCodexQuotaUpdated" }, `${t("quotaUpdatedAt")}${t("locale").toLowerCase().startsWith("zh") ? "：" : ": "}${new Date(usage.observedAt).toLocaleString(t("locale"))}`))
    }

    function objectAtPath(root, path) {
      let current = root
      for (const key of path) {
        if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined
        current = current[key]
      }
      return current
    }

    function modelRows(value) {
      if (!Array.isArray(value)) return []
      return value.filter((row) => typeof row === "object" && row !== null && !Array.isArray(row) && typeof row.id === "string" && row.id.length > 0)
    }

    function discoveredModels(value) {
      if (!Array.isArray(value)) return []
      const seen = new Set()
      const rows = []
      for (const candidate of value) {
        if (typeof candidate !== "object" || candidate === null || typeof candidate.id !== "string" || candidate.id.length === 0 || seen.has(candidate.id)) continue
        seen.add(candidate.id)
        rows.push({
          id: candidate.id,
          ...(typeof candidate.name === "string" && candidate.name.length > 0 ? { name: candidate.name } : {}),
          ...(Number.isSafeInteger(candidate.contextWindow) && candidate.contextWindow > 0
            ? { contextWindow: candidate.contextWindow }
            : {}),
          ...(Number.isSafeInteger(candidate.maxTokens) && candidate.maxTokens > 0
            ? { maxTokens: candidate.maxTokens }
            : {}),
        })
      }
      return rows
    }

    function formatModelTokenCount(value, locale) {
      const divisor = value >= 1_000_000 ? 1_000_000 : value >= 1_000 ? 1_000 : 1
      const suffix = divisor === 1_000_000 ? "M" : divisor === 1_000 ? "K" : ""
      const compact = value / divisor
      try {
        return `${compact.toLocaleString(locale, { maximumFractionDigits: 1 })}${suffix}`
      } catch {
        return `${Math.round(compact * 10) / 10}${suffix}`
      }
    }

    function modelSavePlan(snapshot, selectedIds) {
      const selected = new Set(selectedIds)
      const modelIds = snapshot.models.map((model) => model.id)
      const catalogIds = Array.isArray(snapshot.catalogIds)
        ? snapshot.catalogIds.filter((id) => typeof id === "string")
        : modelIds
      const catalogSet = new Set(catalogIds)
      const orderedSelected = modelIds.filter((id) => selected.has(id))
      const existing = new Map(snapshot.configuredModels.map((model) => [model.id, model]))
      const models = orderedSelected.map((id) => existing.has(id) ? { ...existing.get(id) } : { id })
      const allCatalogSelected = catalogIds.length > 0 && catalogIds.every((id) => selected.has(id))
      const hasSelectedOutsideCatalog = orderedSelected.some((id) => !catalogSet.has(id))
      const hasAdditionalFields = models.some((model) => Object.keys(model).some((key) => key !== "id"))

      return {
        orderedSelected,
        models,
        allCatalogSelected,
        unsetOverride: allCatalogSelected && !hasSelectedOutsideCatalog && !hasAdditionalFields,
      }
    }

    function createModelEnablementClient(connection, settingsFace) {
      const api = connection?.api
      const available = typeof api?.llm?.discoverModels === "function"
        && typeof api?.settings?.mutate === "function"
        && typeof settingsFace?.ensure === "function"
        && typeof settingsFace?.getSnapshot === "function"
        && typeof settingsFace?.subscribe === "function"
        && typeof settingsFace?.acceptView === "function"

      const load = async (signal) => {
        if (!available) return { kind: "unavailable" }

        const [catalogResponse] = await Promise.all([
          api.llm.discoverModels({ settingsNs: CODEX_SETTINGS_NS, provider: CODEX_PROVIDER }, signal),
          settingsFace.ensure(),
        ])
        const discovered = discoveredModels(resultValue(catalogResponse).models)
        const mirror = settingsFace.getSnapshot()
        if (mirror?.status !== "ready" || mirror.view === undefined) return { kind: "unavailable" }
        const settings = mirror.view
        const namespace = Array.isArray(settings.namespaces)
          ? settings.namespaces.find((entry) => entry?.ns === CODEX_SETTINGS_NS)
          : undefined
        if (namespace === undefined || typeof namespace.revision !== "number") return { kind: "unavailable" }

        const modelsPath = [...CODEX_SETTINGS_PATH, "models"]
        const userModelsValue = objectAtPath(namespace.user, modelsPath)
        const resolvedModelsValue = objectAtPath(namespace.value, modelsPath)
        const hasUserModelOverride = Array.isArray(userModelsValue)
        const hasResolvedModelOverride = Array.isArray(resolvedModelsValue)
        const configuredModels = hasUserModelOverride
          ? modelRows(userModelsValue)
          : hasResolvedModelOverride
            ? modelRows(resolvedModelsValue)
            : []
        const hasModelOverride = hasUserModelOverride || hasResolvedModelOverride
        const discoveredIds = new Set(discovered.map((model) => model.id))
        const customModels = configuredModels
          .filter((model) => !discoveredIds.has(model.id))
          .map((model) => ({
            id: model.id,
            ...(typeof model.name === "string" && model.name.length > 0 ? { name: model.name } : {}),
          }))
        const catalog = [...discovered, ...customModels]
        const configuredIds = new Set(configuredModels.map((model) => model.id))
        const selectedIds = hasModelOverride
          ? catalog.filter((model) => configuredIds.has(model.id)).map((model) => model.id)
          : catalog.map((model) => model.id)

        return {
          kind: "ready",
          writable: settings.writable === true,
          revision: namespace.revision,
          settingsNs: CODEX_SETTINGS_NS,
          settingsPath: [...CODEX_SETTINGS_PATH],
          models: catalog,
          catalogIds: discovered.map((model) => model.id),
          selectedIds,
          configuredModels: configuredModels.map((model) => ({ ...model })),
        }
      }

      const save = async (snapshot, selectedIds, signal) => {
        if (!available || snapshot?.kind !== "ready") throw new Error("Codex model management is unavailable")
        const plan = modelSavePlan(snapshot, selectedIds)
        const { orderedSelected, models } = plan
        if (orderedSelected.length === 0) {
          const error = new Error("At least one Codex model must remain enabled")
          error.code = "AT_LEAST_ONE_MODEL"
          throw error
        }

        const modelsPath = [...snapshot.settingsPath, "models"]
        const response = await api.settings.mutate({
          ns: snapshot.settingsNs,
          ops: [plan.unsetOverride
            ? { op: "unset", path: modelsPath }
            : { op: "set", path: modelsPath, value: models }],
          expectedRevision: snapshot.revision,
        }, signal)
        const namespace = resultValue(response)
        settingsFace.acceptView(namespace)
        return {
          ...snapshot,
          revision: typeof namespace.revision === "number" ? namespace.revision : snapshot.revision,
          selectedIds: orderedSelected,
          configuredModels: plan.unsetOverride ? [] : models,
        }
      }

      const subscribe = (listener) => available ? settingsFace.subscribe(listener) : () => undefined
      return Object.freeze({ available, load, save, subscribe })
    }

    function AuthorizationSettings({ client, t }) {
      const [snapshot, setSnapshot] = React.useState({ status: "loading" })
      const [usageSnapshot, setUsageSnapshot] = React.useState({ status: "idle" })
      const [attempt, setAttempt] = React.useState(null)
      const [notices, setNotices] = React.useState([])
      const [prompt, setPrompt] = React.useState(null)
      const [answer, setAnswer] = React.useState("")
      const [outcome, setOutcome] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [responding, setResponding] = React.useState(false)
      const [cancelling, setCancelling] = React.useState(false)
      const [loggingOut, setLoggingOut] = React.useState(false)
      const attemptRef = React.useRef(null)
      const pendingStartRef = React.useRef(null)
      const mountedRef = React.useRef(false)
      const attemptGenerationRef = React.useRef(0)
      const responseGenerationRef = React.useRef(0)
      const refreshGenerationRef = React.useRef(0)
      const refreshControllerRef = React.useRef(null)

      const refresh = React.useCallback(async () => {
        if (!mountedRef.current) return
        const generation = ++refreshGenerationRef.current
        refreshControllerRef.current?.abort()
        const controller = new AbortController()
        refreshControllerRef.current = controller
        setSnapshot((current) => current.status === "ready" ? current : { status: "loading" })
        try {
          const value = await client.describe(controller.signal)
          if (!mountedRef.current || generation !== refreshGenerationRef.current || controller.signal.aborted) return
          setSnapshot({ status: "ready", value })
          const credentialState = value?.credential?.state
          const signedIn = credentialState === "signed-in"
            || (credentialState === undefined && value?.credential?.configured === true)
          if (!signedIn || typeof client.usage !== "function") {
            setUsageSnapshot({ status: "idle" })
            return
          }
          setUsageSnapshot((current) => ({
            status: "loading",
            ...(current.value === undefined ? {} : { value: current.value }),
          }))
          try {
            const usage = safeAccountUsage(await client.usage(controller.signal))
            if (usage === undefined) throw new Error("invalid account usage")
            if (!mountedRef.current || generation !== refreshGenerationRef.current || controller.signal.aborted) return
            setUsageSnapshot({ status: "ready", value: usage })
          } catch {
            if (!mountedRef.current || generation !== refreshGenerationRef.current || controller.signal.aborted) return
            setUsageSnapshot((current) => ({
              status: "error",
              ...(current.value === undefined ? {} : { value: current.value }),
            }))
          }
        } catch {
          if (!mountedRef.current || generation !== refreshGenerationRef.current || controller.signal.aborted) return
          setSnapshot({ status: "error" })
        } finally {
          if (generation === refreshGenerationRef.current && refreshControllerRef.current === controller) {
            refreshControllerRef.current = null
          }
        }
      }, [client])

      React.useEffect(() => {
        mountedRef.current = true
        void refresh()
        return () => {
          mountedRef.current = false
          refreshGenerationRef.current += 1
          refreshControllerRef.current?.abort()
          refreshControllerRef.current = null
          attemptGenerationRef.current += 1
          responseGenerationRef.current += 1
          pendingStartRef.current = null
          const current = attemptRef.current
          attemptRef.current = null
          current?.controller.abort()
          if (current !== null && !current.done) void client.cancel(current.id).catch(() => undefined)
        }
      }, [client])

      const consume = async (current) => {
        const isCurrent = () => mountedRef.current
          && attemptGenerationRef.current === current.generation
          && attemptRef.current === current
          && !current.controller.signal.aborted
        let after = 0
        try {
          while (isCurrent()) {
            const page = await client.watch(current.id, after, current.controller.signal)
            if (!isCurrent()) return
            after = page.nextSeq
            for (const event of page.events) {
              if (!isCurrent()) return
              if (event.type === "notice") {
                setNotices((items) => [...items, event.notice].slice(-32))
              } else if (event.type === "prompt") {
                setAnswer("")
                setPrompt({ id: event.promptId, value: event.prompt })
              } else if (event.type === "prompt-closed") {
                setPrompt((currentPrompt) => currentPrompt?.id === event.promptId ? null : currentPrompt)
                setAnswer("")
              } else if (event.type === "settled") {
                current.done = true
                responseGenerationRef.current += 1
                setResponding(false)
                setPrompt(null)
                setFailure(null)
                setOutcome(event.status)
              } else if (event.type === "failed") {
                current.done = true
                responseGenerationRef.current += 1
                setResponding(false)
                setPrompt(null)
                setOutcome(null)
                setFailure(event.error.code)
              }
            }
            if (page.done) {
              current.done = true
              break
            }
          }
        } catch {
          if (isCurrent()) setFailure("TRANSPORT")
        } finally {
          if (mountedRef.current
            && attemptGenerationRef.current === current.generation
            && attemptRef.current === current) {
            attemptRef.current = null
            setAttempt(null)
            void refresh()
          }
        }
      }

      const begin = async (method) => {
        if (!mountedRef.current
          || pendingStartRef.current !== null
          || attemptRef.current !== null
          || cancelling
          || loggingOut
          || responding) return
        const generation = ++attemptGenerationRef.current
        const pending = { generation }
        pendingStartRef.current = pending
        setAttempt("starting")
        setNotices([])
        setPrompt(null)
        setOutcome(null)
        setFailure(null)
        try {
          const started = await client.start(method)
          if (!mountedRef.current
            || attemptGenerationRef.current !== generation
            || pendingStartRef.current !== pending) {
            void client.cancel(started.attemptId).catch(() => undefined)
            return
          }
          pendingStartRef.current = null
          const current = {
            id: started.attemptId,
            controller: new AbortController(),
            generation,
            done: false,
          }
          attemptRef.current = current
          setAttempt(current.id)
          void consume(current)
        } catch {
          if (!mountedRef.current
            || attemptGenerationRef.current !== generation
            || pendingStartRef.current !== pending) return
          pendingStartRef.current = null
          setAttempt(null)
          setFailure("START_FAILED")
          void refresh()
        }
      }

      const cancel = async () => {
        if (!mountedRef.current || cancelling || loggingOut || responding) return
        const current = attemptRef.current
        const generation = current?.generation ?? attemptGenerationRef.current
        const isCurrentCancellation = () => mountedRef.current
          && attemptGenerationRef.current === generation
          && (current === null
            ? attemptRef.current === null
            : attemptRef.current === current && !current.done)
        if (pendingStartRef.current !== null) {
          attemptGenerationRef.current += 1
          pendingStartRef.current = null
          setAttempt(null)
        }
        setCancelling(true)
        setFailure(null)
        setOutcome(null)
        try {
          const result = await client.cancel(current?.id)
          if (!mountedRef.current) return
          if (current !== null
            && isCurrentCancellation()
            && result?.accepted === false
            && result.reason === "commit-in-progress") {
            setOutcome("commit-in-progress")
          }
          await refresh()
        } catch {
          if (isCurrentCancellation()) setFailure("CANCEL_FAILED")
        } finally {
          if (mountedRef.current) setCancelling(false)
        }
      }

      const logout = async () => {
        if (!mountedRef.current || loggingOut || cancelling || responding || attemptRef.current !== null || pendingStartRef.current !== null) return
        if (typeof window.confirm === "function" && !window.confirm(t("confirmSignOut"))) return
        setLoggingOut(true)
        setFailure(null)
        setOutcome(null)
        try {
          await client.logout()
          if (!mountedRef.current) return
          setNotices([])
          setPrompt(null)
          setAnswer("")
          await refresh()
        } catch {
          if (mountedRef.current) setFailure("LOGOUT_FAILED")
        } finally {
          if (mountedRef.current) setLoggingOut(false)
        }
      }

      const reply = async (action) => {
        const current = attemptRef.current
        if (!mountedRef.current || current === null || prompt === null || responding || cancelling || loggingOut) return
        const generation = current.generation
        const responseGeneration = ++responseGenerationRef.current
        const promptId = prompt.id
        const isCurrentResponse = () => mountedRef.current
          && responseGenerationRef.current === responseGeneration
        setResponding(true)
        setFailure(null)
        try {
          if (action === "decline") await client.decline(current.id, prompt.id)
          else await client.answer(current.id, prompt.id, answer)
          if (!isCurrentResponse()
            || attemptGenerationRef.current !== generation
            || attemptRef.current !== current) return
          setPrompt((currentPrompt) => currentPrompt?.id === promptId ? null : currentPrompt)
          setAnswer("")
        } catch {
          if (isCurrentResponse()
            && attemptGenerationRef.current === generation
            && attemptRef.current === current) setFailure("RESPONSE_FAILED")
        } finally {
          if (isCurrentResponse()) setResponding(false)
        }
      }

      if (snapshot.status === "loading") {
        return h("section", { className: "dshCodexPanel dshCodexCard dshCodexAuthorizationCard", "aria-busy": "true" },
          h("p", { className: "dshCodexMuted" }, t("loading")))
      }
      if (snapshot.status === "error") {
        return h("section", { className: "dshCodexPanel dshCodexCard dshCodexAuthorizationCard" },
          h("p", { role: "alert", className: "dshCodexError" }, t("requestFailed")),
          h("button", { type: "button", className: "dshCodexButton", onClick: refresh }, t("refresh")))
      }

      const view = snapshot.value
      const flow = view.flow
      const authorizationBusy = attempt !== null || flow?.inFlight === true
      const actionBusy = cancelling || loggingOut || responding
      const configured = view.credential.configured === true
      const credentialState = new Set(["signed-in", "signed-out", "invalid"])
        .has(view.credential.state)
        ? view.credential.state
        : configured ? "signed-in" : "signed-out"
      const signedIn = credentialState === "signed-in"
      const statusText = loggingOut
        ? t("signingOut")
        : cancelling
          ? t("cancelling")
          : authorizationBusy
            ? t("inProgress")
            : credentialState === "invalid"
              ? t("credentialInvalid")
              : signedIn
              ? t("signedIn")
              : t("signedOut")
      const quota = safeQuotaSnapshot(view.quota)
      const statusTone = authorizationBusy || cancelling || loggingOut
        ? "busy"
        : credentialState === "invalid"
          ? "invalid"
          : signedIn
            ? "active"
            : "inactive"
      const authorizationActions = flow === undefined
        ? null
        : h("div", { className: "dshCodexActions dshCodexAuthActions" },
            ...flow.methods.map((method) => h("button", {
              key: method.id,
              type: "button",
              className: configured ? "dshCodexButton" : "dshCodexButton dshCodexPrimary",
              disabled: authorizationBusy || actionBusy || view.credential.writable === false,
              onClick: () => void begin(method.id),
            }, configured
              ? t("signInAgain")
              : flow.methods.length === 1
                ? t("signInWithChatGPT")
                : `${t("signIn")} · ${method.label}`)),
            authorizationBusy ? h("button", {
              type: "button",
              className: "dshCodexButton",
              disabled: actionBusy,
              onClick: () => void cancel(),
            }, t("cancel")) : null,
            configured && !authorizationBusy ? h("button", {
              type: "button",
              className: "dshCodexButton",
              disabled: actionBusy,
              onClick: () => void logout(),
            }, loggingOut ? t("signingOut") : t("signOut")) : null)

      const liveUsage = usageSnapshot.value
      let quotaBody
      if (liveUsage !== undefined) {
        quotaBody = h(React.Fragment, null,
          renderAccountUsage(liveUsage, t),
          usageSnapshot.status === "error"
            ? h("p", { role: "status", className: "dshCodexError" }, `${t("quotaLoadFailed")} ${t("quotaStaleHelp")}`)
            : null)
      } else if (usageSnapshot.status === "loading") {
        quotaBody = h("p", { className: "dshCodexMuted", "aria-busy": "true" }, t("quotaLoading"))
      } else if (usageSnapshot.status === "error") {
        quotaBody = h(React.Fragment, null,
          h("p", { role: "status", className: "dshCodexError" }, t("quotaLoadFailed")),
          renderObservedQuota(quota, t))
      } else {
        quotaBody = renderObservedQuota(quota, t)
      }

      return h("section", {
        className: "dshCodexPanel dshCodexCard dshCodexAuthorizationCard",
        "aria-busy": authorizationBusy || actionBusy ? "true" : undefined,
      },
        h("div", { className: "dshCodexAuthToolbar" },
          h("div", {
            className: "dshCodexStatus",
            "data-state": statusTone,
            role: "status",
            "aria-live": "polite",
          },
          h("span", { className: "dshCodexStatusDot", "aria-hidden": "true" }),
          h("strong", null, statusText)),
          authorizationActions),
        credentialState === "invalid"
          ? h("p", { role: "alert", className: "dshCodexError" }, t("credentialInvalidHelp"))
          : null,
        flow === undefined
          ? h("p", { role: "status", className: "dshCodexMuted" }, t("unavailable"))
          : null,
        view.credential.writable === false
          ? h("p", { className: "dshCodexMuted" }, t("writableNo"))
          : null,
        notices.length > 0
          ? h("ol", { className: "dshCodexNotices", "aria-live": "polite" },
              ...notices.map((notice, index) => h("li", { key: `${index}-${notice.message}` },
                h("p", null, notice.message),
                notice.url === undefined ? null : h("a", {
                  href: notice.url,
                  target: "_blank",
                  rel: "noopener noreferrer",
                }, t("openPage")),
                notice.code === undefined ? null : h("div", { className: "dshCodexCode" },
                  h("span", null, t("deviceCode")), h("code", null, notice.code)))))
          : null,
        prompt === null ? null : h("form", {
          className: "dshCodexPrompt",
          onSubmit: (event) => {
            event.preventDefault()
            void reply("answer")
          },
        },
        h("label", null,
          h("span", null, prompt.value.message),
          prompt.value.kind === "select"
            ? h("select", {
                value: answer,
                required: true,
                onChange: (event) => setAnswer(event.currentTarget.value),
              }, h("option", { value: "", disabled: true }, "—"),
              ...prompt.value.options.map((option) => h("option", { key: option.id, value: option.id }, option.label)))
            : h("input", {
                type: prompt.value.kind === "secret" ? "password" : "text",
                value: answer,
                placeholder: prompt.value.placeholder,
                autoComplete: "off",
                required: true,
                onChange: (event) => setAnswer(event.currentTarget.value),
              })),
        h("div", { className: "dshCodexActions" },
          h("button", { type: "submit", className: "dshCodexButton dshCodexPrimary", disabled: actionBusy }, t("submit")),
          h("button", { type: "button", className: "dshCodexButton", disabled: actionBusy, onClick: () => void reply("decline") }, t("decline")))),
        outcome === "authorized" ? h("p", { role: "status", className: "dshCodexSuccess" }, t("authorized")) : null,
        outcome === "cancelled" ? h("p", { role: "status", className: "dshCodexMuted" }, t("cancelled")) : null,
        outcome === "commit-in-progress" ? h("p", { role: "status", className: "dshCodexMuted" }, t("commitInProgress")) : null,
        failure === null ? null : h("p", { role: "alert", className: "dshCodexError", "data-error-code": failure }, t(failureCopyKey(failure))),
        h("section", {
          className: "dshCodexQuota",
          "data-quota-status": quota.status,
          "aria-busy": usageSnapshot.status === "loading" ? "true" : undefined,
          "aria-live": "polite",
          "aria-labelledby": "dsh-codex-quota-title",
        },
        h("div", { className: "dshCodexQuotaHeader" },
          h("h3", { id: "dsh-codex-quota-title" }, t("quotaTitle")),
          h("button", {
            type: "button",
            className: "dshCodexButton dshCodexRefreshButton",
            "data-loading": usageSnapshot.status === "loading" ? "true" : undefined,
            "aria-busy": usageSnapshot.status === "loading" ? "true" : undefined,
            disabled: actionBusy || usageSnapshot.status === "loading",
            onClick: refresh,
          },
          refreshIcon(),
          h("span", null, usageSnapshot.status === "loading" ? t("refreshing") : t("refresh")))),
        liveUsage === undefined
          ? h("p", { className: "dshCodexQuotaProduct" }, t("quotaProduct"))
          : null,
        quotaBody))
    }

    function failureCopyKey(failure) {
      if (failure === "CANCEL_FAILED") return "cancelFailed"
      if (failure === "LOGOUT_FAILED") return "logoutFailed"
      if (failure === "RESPONSE_FAILED") return "responseFailed"
      return "failed"
    }

    function diagnosticsOutcomeCopyKey(outcome) {
      if (outcome === "warning") return "diagnosticsOutcomeWarning"
      if (outcome === "fail") return "diagnosticsOutcomeFail"
      if (outcome === "cancelled") return "diagnosticsOutcomeCancelled"
      return "diagnosticsOutcomePass"
    }

    function diagnosticsStatusCopyKey(status) {
      if (status === "warning") return "diagnosticsStatusWarning"
      if (status === "fail") return "diagnosticsStatusFail"
      if (status === "skipped") return "diagnosticsStatusSkipped"
      return "diagnosticsStatusPass"
    }

    function diagnosticsCheckLabel(checkId, t) {
      if (checkId === "runtime") return t("diagnosticsCheckRuntime")
      if (checkId === "credential") return t("diagnosticsCheckCredential")
      if (checkId === "models") return t("diagnosticsCheckModels")
      if (checkId === "account-usage") return t("diagnosticsCheckAccountUsage")
      return checkId
    }

    function diagnosticsChevron() {
      return h("svg", {
        viewBox: "0 0 16 16",
        width: 16,
        height: 16,
        fill: "none",
        "aria-hidden": "true",
      }, h("path", {
        d: "m4 6 4 4 4-4",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }))
    }

    function ConnectionDiagnosticsSettings({ client, t }) {
      const [expanded, setExpanded] = React.useState(false)
      const [state, setState] = React.useState({ kind: "idle" })
      const instanceId = React.useId().replace(/[^a-zA-Z0-9_-]/gu, "")
      const contentId = `dsh-codex-diagnostics-${instanceId}`
      const mountedRef = React.useRef(false)
      const generationRef = React.useRef(0)
      const controllerRef = React.useRef(null)

      React.useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
          generationRef.current += 1
          controllerRef.current?.abort()
          controllerRef.current = null
        }
      }, [])

      const run = async (mode) => {
        if (!mountedRef.current || state.kind === "running" || !DIAGNOSTIC_MODES.has(mode)) return
        const generation = ++generationRef.current
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        setState({ kind: "running", mode })
        try {
          const report = await client.run(mode, controller.signal)
          if (!mountedRef.current
            || generation !== generationRef.current
            || controller.signal.aborted) return
          setState({ kind: "ready", report })
        } catch {
          if (!mountedRef.current
            || generation !== generationRef.current
            || controller.signal.aborted) return
          setState({ kind: "error", mode })
        } finally {
          if (generation === generationRef.current && controllerRef.current === controller) {
            controllerRef.current = null
          }
        }
      }

      const cancel = () => {
        if (!mountedRef.current || state.kind !== "running") return
        generationRef.current += 1
        controllerRef.current?.abort()
        controllerRef.current = null
        setState({ kind: "cancelled", mode: state.mode })
      }

      let result = null
      if (state.kind === "ready") {
        const report = state.report
        const observedDate = new Date(report.observedAt)
        const observedLabel = Number.isNaN(observedDate.valueOf())
          ? String(report.observedAt)
          : observedDate.toLocaleString(t("locale"))
        result = h("div", {
          className: "dshCodexDiagnosticsResult",
          "data-outcome": report.outcome,
          role: "status",
          "aria-live": "polite",
        },
        h("div", { className: "dshCodexDiagnosticsResultHeader" },
          h("strong", null, t(diagnosticsOutcomeCopyKey(report.outcome))),
          h("span", null,
            `${t("diagnosticsObservedAt")} `,
            h("time", {
              dateTime: Number.isNaN(observedDate.valueOf()) ? undefined : observedDate.toISOString(),
            }, observedLabel))),
        h("ul", { className: "dshCodexDiagnosticsChecks" },
          ...report.checks.map((check) => {
            const facts = check.facts === undefined
              ? []
              : Object.entries(check.facts).map(([key, value]) => `${key}=${String(value)}`)
            return h("li", { key: check.id, "data-status": check.status },
              h("span", { className: "dshCodexDiagnosticsCheckStatus" }, t(diagnosticsStatusCopyKey(check.status))),
              h("strong", null, diagnosticsCheckLabel(check.id, t)),
              h("code", null, check.code),
              facts.length === 0
                ? null
                : h("span", { className: "dshCodexDiagnosticsFacts" }, facts.join(" · ")))
          })))
      } else if (state.kind === "error") {
        result = h("p", { className: "dshCodexError", role: "alert" }, t("diagnosticsFailed"))
      } else if (state.kind === "cancelled") {
        result = h("p", { className: "dshCodexMuted", role: "status" }, t("diagnosticsOutcomeCancelled"))
      }

      const runningMode = state.kind === "running" ? state.mode : null
      return h("section", {
        className: "dshCodexDiagnostics",
        "data-expanded": expanded ? "true" : undefined,
      },
      h("button", {
        type: "button",
        className: "dshCodexDiagnosticsToggle",
        "aria-expanded": expanded ? "true" : "false",
        "aria-controls": contentId,
        onClick: () => setExpanded((current) => !current),
      },
      h("span", { className: "dshCodexDiagnosticsToggleCopy" },
        h("strong", null, t("diagnosticsTitle")),
        h("span", null, t("diagnosticsCollapsedHelp"))),
      diagnosticsChevron()),
      !expanded ? null : h("div", { id: contentId, className: "dshCodexDiagnosticsBody" },
        h("p", { className: "dshCodexMuted" }, t("diagnosticsExpandedHelp")),
        h("div", { className: "dshCodexDiagnosticsModes" },
          h("div", { className: "dshCodexDiagnosticsMode" },
            h("button", {
              type: "button",
              className: "dshCodexButton",
              disabled: runningMode !== null,
              "aria-busy": runningMode === "local" ? "true" : undefined,
              onClick: () => void run("local"),
            }, runningMode === "local" ? t("diagnosticsLocalRunning") : t("diagnosticsLocal")),
            h("span", null, t("diagnosticsLocalHelp"))),
          h("div", { className: "dshCodexDiagnosticsMode" },
            h("button", {
              type: "button",
              className: "dshCodexButton",
              disabled: runningMode !== null,
              "aria-busy": runningMode === "account" ? "true" : undefined,
              onClick: () => void run("account"),
            }, runningMode === "account" ? t("diagnosticsAccountRunning") : t("diagnosticsAccount")),
            h("span", null, t("diagnosticsAccountHelp")))),
        runningMode === null ? null : h("button", {
          type: "button",
          className: "dshCodexDiagnosticsCancel",
          onClick: cancel,
        }, t("diagnosticsCancel")),
        result))
    }

    function ModelEnablementSettings({ client, t }) {
      const [snapshot, setSnapshot] = React.useState(client.available ? { kind: "loading" } : { kind: "unavailable" })
      const [selectedIds, setSelectedIds] = React.useState([])
      const [saving, setSaving] = React.useState(false)
      const [saved, setSaved] = React.useState(false)
      const [failure, setFailure] = React.useState(null)
      const [expanded, setExpanded] = React.useState(false)
      const generationRef = React.useRef(0)
      const mountedRef = React.useRef(false)
      const modelToggleRef = React.useRef(null)
      const focusModelToggleRef = React.useRef(false)

      const refresh = React.useCallback(async () => {
        const generation = ++generationRef.current
        setSaved(false)
        setFailure(null)
        setExpanded(false)
        setSnapshot({ kind: "loading" })
        try {
          const next = await client.load()
          if (generation !== generationRef.current) return
          setSnapshot(next)
          setSelectedIds(next.kind === "ready" ? next.selectedIds : [])
        } catch (error) {
          if (generation !== generationRef.current) return
          const detail = error instanceof Error ? error.message : String(error)
          setSnapshot({ kind: "error", detail })
        }
      }, [client])

      React.useEffect(() => {
        mountedRef.current = true
        const unsubscribe = client.subscribe(() => void refresh())
        if (client.available) void refresh()
        return () => {
          mountedRef.current = false
          generationRef.current += 1
          unsubscribe()
        }
      }, [client, refresh])

      React.useEffect(() => {
        if (!focusModelToggleRef.current) return
        focusModelToggleRef.current = false
        if (typeof modelToggleRef.current?.focus === "function") modelToggleRef.current.focus()
      }, [expanded, selectedIds])

      const toggle = (id) => {
        const selected = selectedIds.includes(id)
        if (selected && selectedIds.length === 1) {
          setFailure(t("modelsAtLeastOne"))
          return
        }
        setSaved(false)
        setFailure(null)
        if (selected && !expanded) focusModelToggleRef.current = true
        setSelectedIds(selected
          ? selectedIds.filter((candidate) => candidate !== id)
          : [...selectedIds, id])
      }

      const save = async () => {
        if (!mountedRef.current || snapshot.kind !== "ready") return
        if (selectedIds.length === 0) {
          setFailure(t("modelsAtLeastOne"))
          return
        }
        setSaving(true)
        setSaved(false)
        setFailure(null)
        try {
          const next = await client.save(snapshot, selectedIds)
          if (!mountedRef.current) return
          setSnapshot(next)
          setSelectedIds(next.selectedIds)
          setSaved(true)
        } catch (error) {
          if (!mountedRef.current) return
          const message = error?.code === "AT_LEAST_ONE_MODEL"
            ? t("modelsAtLeastOne")
            : `${t("modelsSaveFailed")} ${error instanceof Error ? error.message : String(error)}`
          setFailure(message)
        } finally {
          if (mountedRef.current) setSaving(false)
        }
      }

      let content
      let modelSummary = null
      if (snapshot.kind === "loading") {
        content = h("p", { className: "dshCodexMuted", "aria-busy": "true" }, t("modelsLoading"))
      } else if (snapshot.kind === "unavailable") {
        content = h(React.Fragment, null,
          h("p", { role: "status", className: "dshCodexMuted" }, t("modelsUnavailable")),
          client.available ? h("button", { type: "button", className: "dshCodexButton", onClick: refresh }, t("modelsRetry")) : null)
      } else if (snapshot.kind === "error") {
        content = h(React.Fragment, null,
          h("p", { role: "alert", className: "dshCodexError" }, `${t("modelsLoadFailed")} ${snapshot.detail}`),
          h("button", { type: "button", className: "dshCodexButton", onClick: refresh }, t("modelsRetry")))
      } else if (snapshot.models.length === 0) {
        content = h(React.Fragment, null,
          h("p", { role: "status", className: "dshCodexMuted" }, t("modelsEmpty")),
          h("button", { type: "button", className: "dshCodexButton", onClick: refresh }, t("modelsRetry")))
      } else {
        const selected = new Set(selectedIds)
        const original = new Set(snapshot.selectedIds)
        const dirty = selected.size !== original.size || [...selected].some((id) => !original.has(id))
        const plan = modelSavePlan(snapshot, selectedIds)
        const selectedModels = snapshot.models.filter((model) => selected.has(model.id))
        const unselectedModels = snapshot.models.filter((model) => !selected.has(model.id))
        const hiddenModelCount = unselectedModels.length
        const visibleModels = expanded
          ? [...selectedModels, ...unselectedModels]
          : selectedModels
        modelSummary = t("modelsSummary")
          .replace("{selected}", String(selected.size))
          .replaceAll("{total}", String(snapshot.models.length))
          .replace("{visible}", String(visibleModels.length))
        const modelItems = visibleModels.map((model) => {
          const metadata = [
            ...(model.contextWindow === undefined
              ? []
              : [`${t("modelsContextWindow")} ${formatModelTokenCount(model.contextWindow, t("locale"))}`]),
            ...(model.maxTokens === undefined
              ? []
              : [`${t("modelsMaxOutput")} ${formatModelTokenCount(model.maxTokens, t("locale"))}`]),
          ]
          return h("li", { key: model.id },
            h("label", {
              className: "dshCodexModelOption",
              "data-selected": selected.has(model.id) ? "true" : undefined,
            },
              h("input", {
                type: "checkbox",
                checked: selected.has(model.id),
                disabled: saving || !snapshot.writable,
                onChange: () => toggle(model.id),
              }),
              h("span", { className: "dshCodexModelCopy" },
                h("span", { className: "dshCodexModelHeading" },
                  h("strong", null, model.name ?? model.id),
                  model.name === undefined || model.name === model.id
                    ? null
                    : h("code", { className: "dshCodexModelId" }, model.id)),
                metadata.length === 0
                  ? null
                  : h("span", { className: "dshCodexModelCapabilities" },
                      ...metadata.map((label) => h("span", {
                        key: label,
                        className: "dshCodexModelBadge",
                      }, label))))))
        })
        content = h(React.Fragment, null,
          snapshot.writable ? null : h("p", { className: "dshCodexMuted" }, t("modelsReadOnly")),
          h("ul", {
            id: "dsh-codex-model-list",
            className: "dshCodexModelList",
            "aria-labelledby": "dsh-codex-models-title",
          }, ...modelItems),
          hiddenModelCount === 0 ? null : h("button", {
            type: "button",
            className: "dshCodexButton dshCodexModelToggle",
            "aria-controls": "dsh-codex-model-list",
            "aria-expanded": expanded ? "true" : "false",
            ref: modelToggleRef,
            disabled: saving,
            onClick: () => setExpanded((current) => !current),
          }, expanded
            ? t("modelsCollapse")
            : t("modelsShowMore").replace("{count}", String(hiddenModelCount))),
          plan.allCatalogSelected ? h("p", { className: "dshCodexMuted" }, t(plan.unsetOverride
            ? "modelsAllEnabledFollow"
            : "modelsAllEnabledPreserve")) : null,
          h("div", { className: "dshCodexActions dshCodexModelActions" },
            h("button", {
              type: "button",
              className: "dshCodexButton dshCodexPrimary",
              disabled: saving || !snapshot.writable || selected.size === 0 || !dirty,
              onClick: () => void save(),
            }, saving ? t("modelsSaving") : t("modelsSave")),
            h("button", {
              type: "button",
              className: "dshCodexButton",
              disabled: saving,
              onClick: () => void refresh(),
            }, t("modelsRetry"))),
          saved ? h("p", { role: "status", className: "dshCodexSuccess" }, t("modelsSaved")) : null,
          failure === null ? null : h("p", { role: "alert", className: "dshCodexError" }, failure))
      }

      return h("section", { className: "dshCodexPanel dshCodexCard dshCodexModelPanel" },
        h("header", { className: "dshCodexHeader" },
          h("div", null,
            h("div", { className: "dshCodexModelTitleRow" },
              h("h3", { id: "dsh-codex-models-title" }, t("modelsTitle")),
              modelSummary === null
                ? null
                : h("span", { className: "dshCodexModelSummary" }, modelSummary)),
            h("p", { className: "dshCodexWarning" }, t("modelsDescription")))),
        content)
    }

    function CodexSettings({ client, diagnosticsClient, modelClient, t }) {
      return h("div", { className: "dshCodexPage" },
        h("header", { className: "dshCodexHero" },
          h("h2", null, t("title")),
          h("p", null, t("description"))),
        h(AuthorizationSettings, { client, t }),
        h(ConnectionDiagnosticsSettings, { client: diagnosticsClient, t }),
        h(ModelEnablementSettings, { client: modelClient, t }))
    }

    const inject = ["slots", "locale", "connection", "settingsScope"]

    function apply(ctx) {
      ctx.effect(installStyle, "dsh-codex: client styles")
      ctx.effect(installSettingsNavIcon, "dsh-codex: settings nav icon")
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-codex: client dictionaries")
      const t = ctx.locale.bind(NS)
      const client = createAuthorizationClient(ctx.connection)
      const diagnosticsClient = createConnectionDiagnosticsClient(ctx.connection)
      const sessionPreferenceClient = createSessionPreferenceClient(ctx.connection)
      const modelClient = createModelEnablementClient(ctx.connection, ctx.settingsScope?.describe?.())
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "codex",
        order: 15,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({ client, diagnosticsClient, modelClient, t }),
      }, CodexSettings))
      ctx.inject?.(["slots", "modelDirectories"], (scope) => {
        scope.slots.inject("conversation.input.right", () => scope.slots.register({
          name: "conversation.input.right",
          id: "dsh-codex-fast",
          order: 100,
          locale: NS,
          inject: (sessionId) => {
            const directory = scope.modelDirectories.directoryFor(sessionId)
            return {
              preferenceClient: sessionPreferenceClient.forSession(sessionId),
              selectModel: (selection) => directory.select(selection),
              t,
              hooks: {
                modelDirectory: directory.store,
              },
            }
          },
        }, CodexFastToggle))
      })
    }

    function installSettingsNavIcon() {
      if (typeof document === "undefined" || typeof window === "undefined") return undefined
      const Observer = typeof window.MutationObserver === "function"
        ? window.MutationObserver
        : typeof MutationObserver === "function" ? MutationObserver : undefined
      if (!document.body || typeof document.querySelectorAll !== "function" || Observer === undefined) return undefined

      const isInsideSettingsNav = (target) => {
        const element = target?.nodeType === 1 ? target : target?.parentElement
        return typeof element?.closest === "function" && element.closest(SETTINGS_NAV_SELECTOR) !== null
      }
      const matchesOrContains = (node, selector) => (
        (typeof node?.matches === "function" && node.matches(selector))
        || (typeof node?.querySelector === "function" && node.querySelector(selector) !== null)
      )
      const mutationTouchesSettingsNav = (records) => Array.from(records ?? []).some((record) => {
        if (isInsideSettingsNav(record.target)) return true
        return [...Array.from(record.addedNodes ?? []), ...Array.from(record.removedNodes ?? [])]
          .some((node) => matchesOrContains(node, SETTINGS_DIALOG_SELECTOR) || matchesOrContains(node, SETTINGS_NAV_SELECTOR))
      })
      const enqueueMicrotask = typeof window.queueMicrotask === "function"
        ? (callback) => window.queueMicrotask(callback)
        : (callback) => Promise.resolve().then(callback)

      let state = window[NAV_ICON_STATE_KEY]
      if (state === undefined) {
        let style = document.querySelector(NAV_ICON_STYLE_SELECTOR)
        if (style === null) {
          style = document.createElement("style")
          style.dataset.pluginNavIcon = "dsh-codex-community"
          document.head.appendChild(style)
        }
        style.dataset.plugin = "dsh-codex-community"
        const clearMarkers = () => {
          for (const button of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) button.removeAttribute(NAV_ICON_MARKER)
        }
        state = {
          active: true,
          refs: 0,
          scheduled: false,
          style,
          clearMarkers,
          scheduleSync() {
            if (!state.active || state.scheduled) return
            state.scheduled = true
            enqueueMicrotask(() => {
              state.scheduled = false
              state.sync()
            })
          },
          sync() {
            if (!state.active) return
            clearMarkers()
            const candidates = []
            for (const button of document.querySelectorAll(SETTINGS_NAV_BUTTON_SELECTOR)) {
              const icon = button.firstElementChild
              const labelElement = icon?.nextElementSibling
              if (icon?.localName !== "svg" || labelElement?.localName !== "span") continue
              const label = String(labelElement.textContent ?? "").replace(/\s+/gu, " ").trim()
              if (NAV_ICON_LABELS.has(label)) candidates.push(button)
            }
            if (candidates.length === 1) candidates[0].setAttribute(NAV_ICON_MARKER, "")
          },
        }
        state.observer = new Observer((records) => {
          if (mutationTouchesSettingsNav(records)) state.scheduleSync()
        })
        state.observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        window[NAV_ICON_STATE_KEY] = state
      }

      state.refs += 1
      state.style.textContent = NAV_ICON_CSS
      state.sync()
      let active = true
      return () => {
        if (!active) return
        active = false
        if (window[NAV_ICON_STATE_KEY] !== state) return
        state.refs -= 1
        if (state.refs > 0) return
        state.active = false
        state.observer.disconnect()
        state.clearMarkers()
        if (typeof state.style.remove === "function") state.style.remove()
        else state.style.parentNode?.removeChild(state.style)
        delete window[NAV_ICON_STATE_KEY]
      }
    }

    function installStyle() {
      if (typeof document === "undefined") return undefined
      let style = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
      if (style === null) {
        style = document.createElement("style")
        style.dataset.plugin = "dsh-codex-community"
        style.dataset.pluginCss = STYLE_ID
        document.head.appendChild(style)
      }
      style.textContent = [
        ".dshCodexPage{box-sizing:border-box;display:flex;width:100%;min-width:0;flex-direction:column;gap:12px;padding:4px 0 20px;color:var(--dsw-alias-label-primary);font:inherit}",
        ".dshCodexPage *{box-sizing:border-box}",
        ".dshCodexHero{display:flex;min-width:0;flex-direction:column;gap:8px}",
        ".dshCodexHero h2,.dshCodexHero p{margin:0}",
        ".dshCodexHero h2{font-size:16px;font-weight:500;line-height:24px}",
        ".dshCodexHero p{max-width:760px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}",
        ".dshCodexPanel{display:flex;width:100%;min-width:0;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px}",
        ".dshCodexPanel p,.dshCodexPanel label{overflow-wrap:anywhere;word-break:break-word}",
        ".dshCodexCard{border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-3));padding:18px}",
        ".dshCodexHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}",
        ".dshCodexHeader>div{min-width:0}",
        ".dshCodexHeader h3,.dshCodexHeader p,.dshCodexNotices p,.dshCodexQuota p{margin:0}",
        ".dshCodexHeader h3{font-size:16px;font-weight:500;line-height:24px}",
        ".dshCodexDiagnostics{display:flex;width:100%;min-width:0;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary)}",
        ".dshCodexDiagnosticsToggle{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:12px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:10px 14px}",
        ".dshCodexDiagnosticsToggle:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
        ".dshCodexDiagnosticsToggle:focus-visible,.dshCodexDiagnosticsCancel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,var(--dsw-alias-border-l3));outline-offset:-2px}",
        ".dshCodexDiagnosticsToggle>svg{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}",
        ".dshCodexDiagnostics[data-expanded=true] .dshCodexDiagnosticsToggle>svg{transform:rotate(180deg)}",
        ".dshCodexDiagnosticsToggleCopy{display:flex;min-width:0;flex:1;flex-wrap:wrap;align-items:baseline;gap:1px 10px}",
        ".dshCodexDiagnosticsToggleCopy strong{font-size:14px;font-weight:500;line-height:22px}",
        ".dshCodexDiagnosticsToggleCopy>span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dshCodexDiagnosticsBody{display:flex;min-width:0;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);padding:12px 14px 14px}",
        ".dshCodexDiagnosticsBody>p{margin:0}",
        ".dshCodexDiagnosticsModes{display:grid;min-width:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
        ".dshCodexDiagnosticsMode{display:flex;min-width:0;align-items:flex-start;gap:9px}",
        ".dshCodexDiagnosticsMode .dshCodexButton{min-width:104px;flex:none;padding:6px 10px;font-size:12px;line-height:18px}",
        ".dshCodexDiagnosticsMode>span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dshCodexDiagnosticsCancel{align-self:flex-start;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;padding:2px 4px}",
        ".dshCodexDiagnosticsCancel:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
        ".dshCodexDiagnosticsResult{display:flex;min-width:0;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}",
        ".dshCodexDiagnosticsResultHeader{display:flex;min-width:0;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;font-size:12px;line-height:18px}",
        ".dshCodexDiagnosticsResultHeader strong{font-weight:500}",
        ".dshCodexDiagnosticsResult[data-outcome=pass] .dshCodexDiagnosticsResultHeader strong{color:var(--dsw-alias-state-success-primary)}",
        ".dshCodexDiagnosticsResult[data-outcome=warning] .dshCodexDiagnosticsResultHeader strong{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}",
        ".dshCodexDiagnosticsResult[data-outcome=fail] .dshCodexDiagnosticsResultHeader strong{color:var(--dsw-alias-state-error-primary)}",
        ".dshCodexDiagnosticsResultHeader>span{color:var(--dsw-alias-label-tertiary)}",
        ".dshCodexDiagnosticsChecks{display:grid;min-width:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:0;padding:0;list-style:none}",
        ".dshCodexDiagnosticsChecks li{display:flex;min-width:0;flex-wrap:wrap;align-items:baseline;gap:3px 7px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:7px 9px;font-size:12px;line-height:18px}",
        ".dshCodexDiagnosticsChecks strong{font-weight:500}",
        ".dshCodexDiagnosticsChecks code,.dshCodexDiagnosticsFacts{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font:inherit}",
        ".dshCodexDiagnosticsFacts{flex-basis:100%}",
        ".dshCodexDiagnosticsCheckStatus{border-radius:999px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);padding:0 6px}",
        ".dshCodexDiagnosticsChecks li[data-status=pass] .dshCodexDiagnosticsCheckStatus{color:var(--dsw-alias-state-success-primary)}",
        ".dshCodexDiagnosticsChecks li[data-status=fail] .dshCodexDiagnosticsCheckStatus{color:var(--dsw-alias-state-error-primary)}",
        ".dshCodexAuthToolbar{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:18px}",
        ".dshCodexStatus{display:flex;min-width:0;align-items:center;gap:10px;font-size:14px;line-height:22px}",
        ".dshCodexStatus strong{font-weight:500;white-space:nowrap}",
        ".dshCodexStatusDot{width:11px;height:11px;flex:none;border-radius:50%;background:var(--dsw-alias-label-tertiary)}",
        ".dshCodexStatus[data-state=active] .dshCodexStatusDot{background:var(--dsw-alias-state-success-primary)}",
        ".dshCodexStatus[data-state=invalid] .dshCodexStatusDot{background:var(--dsw-alias-state-error-primary)}",
        ".dshCodexStatus[data-state=busy] .dshCodexStatusDot{background:var(--dsw-alias-state-business-primary)}",
        ".dshCodexQuota{display:flex;min-width:0;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:16px}",
        ".dshCodexQuotaHeader{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px}",
        ".dshCodexQuota h3{margin:0;font-size:16px;font-weight:500;line-height:24px}",
        ".dshCodexQuotaProduct{font-size:14px;font-weight:500;line-height:22px}",
        ".dshCodexQuotaState{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px}",
        ".dshCodexQuotaState::before{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-state-success-primary);content:\"\"}",
        ".dshCodexQuotaUnknown::before{background:var(--dsw-alias-label-tertiary)}",
        ".dshCodexQuotaExhausted::before{background:var(--dsw-alias-state-error-primary)}",
        ".dshCodexQuotaExhausted{color:var(--dsw-alias-state-error-primary)}",
        ".dshCodexQuotaGroup{display:flex;min-width:0;flex-direction:column;gap:8px}",
        ".dshCodexQuotaGroup+.dshCodexQuotaGroup{border-top:1px solid var(--dsw-alias-border-l2);padding-top:14px}",
        ".dshCodexQuotaWindows{display:grid;min-width:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
        ".dshCodexQuotaWindow{display:flex;min-width:0;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:11px 12px}",
        ".dshCodexQuotaWindowHeader,.dshCodexQuotaMeta{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px}",
        ".dshCodexQuotaWindowHeader{font-size:14px;line-height:22px}",
        ".dshCodexQuotaWindowHeader strong{font-weight:500;color:var(--dsw-alias-label-secondary)}",
        ".dshCodexQuotaMeta{justify-content:flex-end;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dshCodexQuotaMeta time{cursor:help}",
        ".dshCodexQuotaWindow progress{display:block;width:100%;height:8px;overflow:hidden;border:0;border-radius:999px;appearance:none;-webkit-appearance:none;background:var(--dsw-alias-bg-layer-1)}",
        ".dshCodexQuotaWindow progress::-webkit-progress-bar{border-radius:999px;background:var(--dsw-alias-bg-layer-1)}",
        ".dshCodexQuotaWindow progress::-webkit-progress-value{border-radius:999px;background:var(--dsw-alias-state-business-primary)}",
        ".dshCodexQuotaWindow progress::-moz-progress-bar{border-radius:999px;background:var(--dsw-alias-state-business-primary)}",
        ".dshCodexMuted{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}",
        ".dshCodexQuota .dshCodexQuotaUpdated{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dshCodexWarning{max-width:820px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}",
        ".dshCodexActions{display:flex;min-width:0;flex-wrap:wrap;gap:8px}",
        ".dshCodexAuthActions{margin-left:auto;justify-content:flex-end}",
        ".dshCodexAuthActions .dshCodexButton{height:36px;min-height:36px;border-radius:18px;padding:0 14px;font-size:14px;line-height:22px}",
        ".dshCodexQuotaHeader .dshCodexRefreshButton{display:inline-flex;min-height:30px;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:15px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);padding:0 10px;font-size:12px;line-height:18px;white-space:nowrap}",
        ".dshCodexRefreshIcon{width:14px;height:14px;flex:none}",
        ".dshCodexRefreshButton[data-loading=true] .dshCodexRefreshIcon{animation:dshCodexRefreshSpin .8s linear infinite}",
        "@keyframes dshCodexRefreshSpin{to{transform:rotate(360deg)}}",
        ".dshCodexButton{box-sizing:border-box;max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-word;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;padding:8px 14px;transition:background-color .15s ease,border-color .15s ease}",
        ".dshCodexButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
        ".dshCodexButton:focus-visible,.dshCodexModelOption:has(input:focus-visible){outline:2px solid var(--dsw-alias-brand-primary,var(--dsw-alias-border-l3));outline-offset:2px}",
        ".dshCodexButton:disabled{cursor:not-allowed;opacity:.5}",
        ".dshCodexFastToggle{box-sizing:border-box;display:inline-flex;width:28px;height:28px;flex:none;align-items:center;justify-content:center;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;padding:0;transition:background-color .15s ease,color .15s ease}",
        ".dshCodexFastToggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}",
        ".dshCodexFastToggle[data-fast=true]{background:var(--dsw-alias-state-business-secondary,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-state-business-primary)}",
        ".dshCodexFastToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,var(--dsw-alias-border-l3));outline-offset:2px}",
        ".dshCodexFastToggle:disabled{cursor:not-allowed;opacity:.45}",
        ".dshCodexTransportControl{position:relative;display:inline-flex;width:28px;height:28px;flex:none}",
        ".dshCodexTransportToggle{box-sizing:border-box;display:inline-flex;width:28px;height:28px;flex:none;align-items:center;justify-content:center;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;padding:0;transition:background-color .15s ease,color .15s ease}",
        ".dshCodexTransportToggle:hover:not(:disabled),.dshCodexTransportToggle[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}",
        ".dshCodexTransportToggle[data-transport]:not([data-transport=auto]){color:var(--dsw-alias-state-business-primary)}",
        ".dshCodexTransportToggle:focus-visible,.dshCodexTransportOption:focus-visible,.dshCodexTransportReset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,var(--dsw-alias-border-l3));outline-offset:2px}",
        ".dshCodexTransportToggle:disabled{cursor:not-allowed;opacity:.45}",
        ".dshCodexTransportMenu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;display:flex;width:280px;max-width:calc(100vw - 32px);flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 28px rgb(0 0 0 / .14);padding:6px;color:var(--dsw-alias-label-primary);font:inherit}",
        ".dshCodexTransportOption{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:12px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:8px 9px}",
        ".dshCodexTransportOption:hover,.dshCodexTransportOption[data-selected=true]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
        ".dshCodexTransportOption[data-selected=true]{color:var(--dsw-alias-state-business-primary)}",
        ".dshCodexTransportOption>svg{flex:none}",
        ".dshCodexTransportOptionCopy{display:flex;min-width:0;flex:1;flex-direction:column;gap:1px}",
        ".dshCodexTransportOptionCopy strong{font-size:13px;font-weight:500;line-height:20px}",
        ".dshCodexTransportOptionCopy>span{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}",
        ".dshCodexTransportMenuFooter{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);margin-top:2px;padding:7px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}",
        ".dshCodexTransportReset{flex:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;line-height:17px;cursor:pointer;padding:2px 4px}",
        ".dshCodexTransportReset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
        ".dshCodexTransportReset:disabled{cursor:not-allowed;color:var(--dsw-alias-label-tertiary);opacity:.55}",
        ".dshCodexLegacyRepair{box-sizing:border-box;display:inline-flex;min-width:0;height:28px;flex:none;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary));font:inherit;font-size:12px;line-height:18px;cursor:pointer;padding:0 10px;white-space:nowrap}",
        ".dshCodexLegacyRepair:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
        ".dshCodexLegacyRepair:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,var(--dsw-alias-border-l3));outline-offset:2px}",
        ".dshCodexLegacyRepair:disabled{cursor:not-allowed;opacity:.55}",
        ".dshCodexPrimary{border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary));background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}",
        ".dshCodexPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-state-business-primary))}",
        ".dshCodexModelList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}",
        ".dshCodexModelTitleRow{display:flex;min-width:0;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}",
        ".dshCodexModelSummary{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}",
        ".dshCodexModelOption{display:flex;min-width:0;height:100%;align-items:flex-start;gap:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-1);padding:9px 10px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease}",
        ".dshCodexModelOption:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
        ".dshCodexModelOption[data-selected=true]{border-color:var(--dsw-alias-state-business-primary)}",
        ".dshCodexModelOption:has(input:disabled){cursor:not-allowed;opacity:.65}",
        ".dshCodexModelOption:has(input:disabled):hover{background:transparent}",
        ".dshCodexModelOption input{width:18px;height:18px;flex:none;margin:2px 0 0;accent-color:var(--dsw-alias-state-business-primary)}",
        ".dshCodexModelCopy{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px}",
        ".dshCodexModelHeading{display:flex;min-width:0;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:1px 8px}",
        ".dshCodexModelOption strong{overflow-wrap:anywhere;font-size:14px;font-weight:500;line-height:22px}",
        ".dshCodexModelId{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:12px;line-height:18px}",
        ".dshCodexModelCapabilities{display:flex;min-width:0;flex-wrap:wrap;gap:6px}",
        ".dshCodexModelBadge{display:inline-flex;align-items:center;border-radius:999px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:18px;padding:1px 7px}",
        ".dshCodexModelToggle{align-self:center;border-radius:999px;padding:6px 12px;font-size:12px;line-height:18px}",
        ".dshCodexModelActions{justify-content:flex-end;border-top:1px solid var(--dsw-alias-border-l2);padding-top:16px}",
        ".dshCodexNotices{display:flex;min-width:0;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}",
        ".dshCodexNotices li,.dshCodexPrompt{box-sizing:border-box;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px}",
        ".dshCodexNotices a{display:inline-block;max-width:100%;margin-top:8px;color:var(--dsw-alias-state-business-primary)}",
        ".dshCodexCode{display:flex;min-width:0;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px}",
        ".dshCodexCode code{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-all;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;user-select:all}",
        ".dshCodexPrompt{display:flex;flex-direction:column;gap:12px}",
        ".dshCodexPrompt label{display:flex;min-width:0;flex-direction:column;gap:8px}",
        ".dshCodexPrompt input,.dshCodexPrompt select{box-sizing:border-box;width:100%;min-width:0;height:38px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;padding:0 10px}",
        ".dshCodexError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}",
        ".dshCodexSuccess{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}",
        "@media(prefers-reduced-motion:reduce){.dshCodexRefreshButton[data-loading=true] .dshCodexRefreshIcon{animation:none}.dshCodexDiagnosticsToggle>svg{transition:none}}",
        "@media(max-width:760px){.dshCodexQuotaWindows,.dshCodexModelList,.dshCodexDiagnosticsModes,.dshCodexDiagnosticsChecks{grid-template-columns:1fr}.dshCodexModelActions{justify-content:flex-start}}",
        "@media(max-width:640px){.dshCodexAuthToolbar,.dshCodexHeader{align-items:stretch;flex-direction:column}.dshCodexAuthActions{margin-left:0;justify-content:flex-start}}",
        "@media(max-width:480px){.dshCodexPage{gap:10px;padding:0 0 16px}.dshCodexCard{border-radius:14px;padding:16px}.dshCodexActions{align-items:stretch;flex-direction:column}.dshCodexButton{width:100%}.dshCodexQuotaHeader .dshCodexRefreshButton{width:auto}.dshCodexQuotaWindowHeader{gap:8px}.dshCodexDiagnosticsMode{flex-direction:column}.dshCodexDiagnosticsMode .dshCodexButton{width:100%;min-width:0}.dshCodexDiagnosticsMode>span{max-width:100%;overflow-wrap:anywhere}}",
      ].join("")
      const references = style[STYLE_REF_KEY]
      style[STYLE_REF_KEY] = Number.isSafeInteger(references) && references > 0
        ? references + 1
        : 1
      let active = true
      return () => {
        if (!active) return
        active = false
        const remaining = style[STYLE_REF_KEY]
        if (Number.isSafeInteger(remaining) && remaining > 1) {
          style[STYLE_REF_KEY] = remaining - 1
          return
        }
        delete style[STYLE_REF_KEY]
        if (typeof style.remove === "function") style.remove()
        else style.parentNode?.removeChild(style)
      }
    }

    exports.AuthorizationSettings = AuthorizationSettings
    exports.CHANNEL = CHANNEL
    exports.CODEX_PROVIDER = CODEX_PROVIDER
    exports.ConnectionDiagnosticsSettings = ConnectionDiagnosticsSettings
    exports.CodexFastToggle = CodexFastToggle
    exports.CodexSettings = CodexSettings
    exports.DIAGNOSTICS_CHANNEL = DIAGNOSTICS_CHANNEL
    exports.ModelEnablementSettings = ModelEnablementSettings
    exports.NS = NS
    exports.apply = apply
    exports.createAuthorizationClient = createAuthorizationClient
    exports.createConnectionDiagnosticsClient = createConnectionDiagnosticsClient
    exports.createModelEnablementClient = createModelEnablementClient
    exports.createSessionPreferenceClient = createSessionPreferenceClient
    exports.formatResetDistance = formatResetDistance
    exports.inject = inject
    exports.installSettingsNavIcon = installSettingsNavIcon
    exports.safeQuotaSnapshot = safeQuotaSnapshot
    return module.exports
  },
})
