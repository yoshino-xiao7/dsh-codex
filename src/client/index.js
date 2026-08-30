window.__ModuleLoader__.load({
  id: "dsh-codex-community",
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require("react")
    const h = React.createElement

    const CHANNEL = "/dsh-codex"
    const SESSION_CHANNEL = "/dsh-codex-session"
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
      sidebarQuota: "Codex 使用额度",
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
      sidebarQuota: "Codex usage quota",
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
            setFast: (fast, signal) => call("set-fast", { sessionId, fast }, signal),
          })
        },
      })
    }

    function supportsFastModel(modelId) {
      return modelId === "gpt-5.4"
        || modelId === "gpt-5.5"
        || modelId === "gpt-5.6-luna"
        || modelId === "gpt-5.6-sol"
        || modelId === "gpt-5.6-terra"
    }

    function CodexFastToggle({
      session,
      useModelDirectory,
      preferenceClient,
      selectModel,
      t,
    }) {
      const current = useModelDirectory((state) => state.current ?? null)
      const [preference, setPreference] = React.useState({ status: "loading", fast: false })
      const [repair, setRepair] = React.useState({ key: null, status: "idle" })
      const mountedRef = React.useRef(false)
      const generationRef = React.useRef(0)
      const controllerRef = React.useRef(null)
      const repairAttemptRef = React.useRef(null)
      const isCodex = current?.provider === CODEX_PROVIDER
      const supported = isCodex && supportsFastModel(current?.model)

      const refreshPreference = React.useCallback(async () => {
        if (!mountedRef.current || !isCodex) return
        const generation = ++generationRef.current
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        setPreference((value) => ({ status: "loading", fast: value.fast }))
        try {
          const value = await preferenceClient.get(controller.signal)
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference({ status: "ready", fast: value?.fast === true })
        } catch {
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference((value) => ({ status: "error", fast: value.fast }))
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      }, [isCodex, preferenceClient])

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
        if (!mountedRef.current || !supported || session?.removed === true) return
        if (preference.status === "error") {
          void refreshPreference()
          return
        }
        if (preference.status !== "ready") return
        const generation = ++generationRef.current
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        const nextFast = !preference.fast
        setPreference({ status: "saving", fast: preference.fast })
        try {
          const value = await preferenceClient.setFast(nextFast, controller.signal)
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference({ status: "ready", fast: value?.fast === true })
        } catch {
          if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return
          setPreference({ status: "error", fast: preference.fast })
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      }

      if (!isCodex) return null
      const label = !supported
        ? t("fastUnsupported")
        : preference.status === "loading" || preference.status === "saving"
          ? t("fastLoading")
          : preference.status === "error"
            ? t("fastUnavailable")
            : preference.fast
              ? t("fastDisable")
              : t("fastEnable")
      const disabled = !supported
        || session?.removed === true
        || preference.status === "loading"
        || preference.status === "saving"

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

      if (!legacySelection || typeof selectModel !== "function") return fastButton
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
        fastButton)
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

    function CodexSettings({ client, modelClient, t }) {
      return h("div", { className: "dshCodexPage" },
        h("header", { className: "dshCodexHero" },
          h("h2", null, t("title")),
          h("p", null, t("description"))),
        h(AuthorizationSettings, { client, t }),
        h(ModelEnablementSettings, { client: modelClient, t }))
    }

    function useCurrentProvider(ctx) {
      const [provider, setProvider] = React.useState()
      React.useEffect(() => {
        let stopDirectory = () => {}
        let active = true
        const bind = () => {
          stopDirectory(); stopDirectory = () => {}
          const sessionId = ctx.sessions.list.getSnapshot().current
          if (sessionId === undefined) return
          let directory
          try { directory = ctx.modelDirectories.directoryFor(sessionId) } catch { return }
          const publish = () => {
            const selected = directory.store.getSnapshot().current?.provider
            if (active && selected !== undefined) setProvider(selected)
          }
          publish()
          stopDirectory = directory.store.subscribe(publish)
          if (directory.store.getSnapshot().current === null) void directory.load().catch(() => {})
        }
        const stopSessions = ctx.sessions.list.subscribe(bind)
        bind()
        return () => { active = false; stopSessions(); stopDirectory() }
      }, [ctx])
      return provider
    }

    function quotaWindows(usage) {
      const windows = usage?.rateLimits?.flatMap((limit) => [limit.primary, limit.secondary]).filter(Boolean) ?? []
      return {
        fiveHour: windows.find((window) => window.windowDurationMins === 300),
        weekly: windows.find((window) => window.windowDurationMins === 10_080),
      }
    }

    function CodexSidebarQuota({ wide, ctx, client, t }) {
      const provider = useCurrentProvider(ctx)
      const [usage, setUsage] = React.useState()
      const [busy, setBusy] = React.useState(false)
      const refresh = React.useCallback(async () => {
        setBusy(true)
        try { setUsage(safeAccountUsage(await client.usage())) } catch { setUsage(undefined) }
        finally { setBusy(false) }
      }, [client])
      React.useEffect(() => { if (provider === CODEX_PROVIDER) void refresh() }, [provider, refresh])
      if (provider !== CODEX_PROVIDER) return null
      const { fiveHour, weekly } = quotaWindows(usage)
      const row = (window, label) => {
        const remaining = window === undefined ? "—" : `${percentText(100 - window.usedPercent)}%`
        const reset = window === undefined ? t("quotaUnknown") : formatResetDistance(window.resetsAt, t)
        return { label, remaining, reset }
      }
      const five = row(fiveHour, t("quotaFiveHour"))
      const week = row(weekly, t("quotaWeekly"))
      const aria = `${five.label} ${five.remaining}, ${five.reset}; ${week.label} ${week.remaining}, ${week.reset}`
      return h("button", {
        type: "button", disabled: busy, onClick: () => void refresh(),
        className: wide ? "dshCodexSidebarQuota" : "dshCodexSidebarQuotaRail", "aria-label": aria,
      }, wide
        ? h(React.Fragment, null,
          h("span", { className: "dshCodexSidebarQuotaMark", "aria-hidden": "true" }, "C"),
          h("span", { className: "dshCodexSidebarQuotaCopy" },
            h("span", null, `${five.label} ${five.remaining}`, h("small", null, five.reset)),
            h("span", null, `${week.label} ${week.remaining}`, h("small", null, week.reset))),
          h("span", { "aria-hidden": "true" }, busy ? "…" : "↻"))
        : h("span", null, `5h ${five.remaining}`))
    }

    const inject = ["slots", "locale", "connection", "settingsScope", "sessions", "modelDirectories"]

    function apply(ctx) {
      ctx.effect(installStyle, "dsh-codex: client styles")
      ctx.effect(installSettingsNavIcon, "dsh-codex: settings nav icon")
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-codex: client dictionaries")
      const t = ctx.locale.bind(NS)
      const client = createAuthorizationClient(ctx.connection)
      const sessionPreferenceClient = createSessionPreferenceClient(ctx.connection)
      const modelClient = createModelEnablementClient(ctx.connection, ctx.settingsScope?.describe?.())
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "codex",
        order: 15,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({ client, modelClient, t }),
      }, CodexSettings))
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action", id: "codex-account-quota", order: 35, label: t("sidebarQuota"),
        inject: () => ({ ctx, client, t }),
      }, CodexSidebarQuota))
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
        ".dshCodexSidebarQuota{display:grid;width:100%;min-height:58px;margin:3px 0;padding:4px 3px;border:0;border-radius:8px;grid-template-columns:22px minmax(0,1fr) 16px;align-items:center;gap:10px;color:inherit;background:transparent;cursor:pointer;font:inherit;text-align:left}.dshCodexSidebarQuota:hover,.dshCodexSidebarQuotaRail:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshCodexSidebarQuotaMark{font-weight:700;text-align:center}.dshCodexSidebarQuotaCopy{display:grid;min-width:0;gap:2px}.dshCodexSidebarQuotaCopy>span{display:flex;min-width:0;justify-content:space-between;gap:6px;font-size:11px}.dshCodexSidebarQuotaCopy small{overflow:hidden;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}.dshCodexSidebarQuotaRail{display:grid;width:36px;height:36px;margin:4px auto;border:0;border-radius:8px;place-items:center;color:inherit;background:transparent;cursor:pointer;font-size:9px;font-weight:700}",
        ".dshCodexPrompt{display:flex;flex-direction:column;gap:12px}",
        ".dshCodexPrompt label{display:flex;min-width:0;flex-direction:column;gap:8px}",
        ".dshCodexPrompt input,.dshCodexPrompt select{box-sizing:border-box;width:100%;min-width:0;height:38px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;padding:0 10px}",
        ".dshCodexError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}",
        ".dshCodexSuccess{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}",
        "@media(prefers-reduced-motion:reduce){.dshCodexRefreshButton[data-loading=true] .dshCodexRefreshIcon{animation:none}}",
        "@media(max-width:760px){.dshCodexQuotaWindows,.dshCodexModelList{grid-template-columns:1fr}.dshCodexModelActions{justify-content:flex-start}}",
        "@media(max-width:640px){.dshCodexAuthToolbar,.dshCodexHeader{align-items:stretch;flex-direction:column}.dshCodexAuthActions{margin-left:0;justify-content:flex-start}}",
        "@media(max-width:480px){.dshCodexPage{gap:10px;padding:0 0 16px}.dshCodexCard{border-radius:14px;padding:16px}.dshCodexActions{align-items:stretch;flex-direction:column}.dshCodexButton{width:100%}.dshCodexQuotaHeader .dshCodexRefreshButton{width:auto}.dshCodexQuotaWindowHeader{gap:8px}}",
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
    exports.CodexFastToggle = CodexFastToggle
    exports.CodexSettings = CodexSettings
    exports.ModelEnablementSettings = ModelEnablementSettings
    exports.NS = NS
    exports.apply = apply
    exports.createAuthorizationClient = createAuthorizationClient
    exports.createModelEnablementClient = createModelEnablementClient
    exports.createSessionPreferenceClient = createSessionPreferenceClient
    exports.formatResetDistance = formatResetDistance
    exports.inject = inject
    exports.installSettingsNavIcon = installSettingsNavIcon
    exports.safeQuotaSnapshot = safeQuotaSnapshot
    return module.exports
  },
})
