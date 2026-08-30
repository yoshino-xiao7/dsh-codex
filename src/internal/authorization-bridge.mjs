import { randomUUID } from "node:crypto"

import { AuthorizationDeclinedError } from "@deepseek-ai/dsh-authorization"

import {
  CODEX_CREDENTIAL_KEY,
  CODEX_PROVIDER_ID,
  createCodexCredentialStore,
} from "./codex-credential-store.mjs"

export const AUTHORIZATION_RPC_CHANNEL = "/dsh-codex"
export const CODEX_AUTHORIZATION_KEY = CODEX_CREDENTIAL_KEY

const ATTEMPT_RETENTION_MS = 5 * 60_000
const STATUS_WAIT_MS = 25_000
const MAX_EVENTS = 128
const MAX_NOTICES = 32
const MAX_ATTEMPTS = 8
const MAX_RETAINED_ATTEMPTS = 64
const MAX_WAITERS_PER_ATTEMPT = 8
const MAX_METHODS = 16
const MAX_OPTIONS = 64
const MAX_ID_CHARS = 128
const MAX_ANSWER_CHARS = 16_384
const MAX_MESSAGE_CHARS = 2_048
const MAX_PLACEHOLDER_CHARS = 512
const MAX_CODE_CHARS = 256
const MAX_URL_CHARS = 2_048
const MAX_USAGE_SUMMARY_LIMITS = 16
const MAX_USAGE_WINDOW_MINS = 525_600
const MAX_USAGE_LABEL_CHARS = 128

class RpcInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "RpcInputError"
  }
}

/**
 * A short-lived interaction adapter around the public authorization seam.
 * It never reads a credential value: only describeRecord() presence metadata
 * crosses the interface, while notices and prompt answers live in memory for
 * the duration of one loopback browser interaction.
 */
export class CodexAuthorizationBridge {
  #authorization
  #credentials
  #commitTracker
  #quotaObserver
  #accountUsageReader
  #attempts = new Map()
  #closed = false
  #retentionMs
  #waitMs

  constructor({ authorization, credentials }, options = {}) {
    this.#authorization = authorization
    this.#credentials = credentials
    this.#commitTracker = options.commitTracker
    this.#quotaObserver = options.quotaObserver
    this.#accountUsageReader = options.accountUsageReader
    this.#retentionMs = options.retentionMs ?? ATTEMPT_RETENTION_MS
    this.#waitMs = options.waitMs ?? STATUS_WAIT_MS
  }

  async status(payload = {}, signal) {
    const input = objectInput(payload)
    assertOnlyKeys(input, ["attemptId", "after"])
    if (input.attemptId === undefined) {
      if (input.after !== undefined) throw new RpcInputError("after requires attemptId")
      return this.#publicStatus()
    }

    const attemptId = requiredString(input, "attemptId", { maxLength: MAX_ID_CHARS })
    const after = optionalSequence(input.after)
    const attempt = this.#attempt(attemptId)
    await waitForAttempt(attempt, after, signal, this.#waitMs)
    return {
      attemptId,
      events: attempt.events.filter((event) => event.seq > after),
      nextSeq: attempt.events.at(-1)?.seq ?? after,
      done: attempt.done,
    }
  }

  async start(payload = {}) {
    this.#assertOpen()
    const input = objectInput(payload)
    assertOnlyKeys(input, ["method"])
    const activeAttempts = [...this.#attempts.values()].filter((attempt) => !attempt.done).length
    if (activeAttempts >= MAX_ATTEMPTS) {
      throw new RpcInputError("Too many authorization attempts")
    }
    if (this.#attempts.size >= MAX_RETAINED_ATTEMPTS) {
      throw new RpcInputError("Too many recent authorization attempts")
    }
    const method = optionalString(input, "method", { maxLength: MAX_ID_CHARS })
    const entry = this.#authorization.describe(CODEX_AUTHORIZATION_KEY)
    if (entry === undefined) throw new RpcInputError("Codex authorization is unavailable")
    if (method !== undefined && !entry.methods.some((candidate) => candidate.id === method)) {
      throw new RpcInputError("Unknown Codex authorization method")
    }

    const attempt = {
      id: randomUUID(),
      controller: new AbortController(),
      events: [],
      nextSeq: 1,
      noticeCount: 0,
      prompt: undefined,
      waiters: new Set(),
      done: false,
      cleanup: undefined,
    }
    this.#attempts.set(attempt.id, attempt)

    void Promise.resolve().then(() => this.#authorization.begin({
      key: CODEX_AUTHORIZATION_KEY,
      ...(method === undefined ? {} : { method }),
      signal: attempt.controller.signal,
      interaction: {
        notify: (notice) => {
          if (!attempt.done && attempt.noticeCount < MAX_NOTICES) {
            attempt.noticeCount += 1
            this.#emit(attempt, {
              type: "notice",
              notice: serializeNotice(notice),
            })
          }
        },
        prompt: (prompt) => this.#prompt(attempt, prompt),
      },
    })).then(
      (outcome) => this.#settle(attempt, {
        type: "settled",
        status: outcome.status,
      }),
      (error) => this.#settle(attempt, {
        type: "failed",
        error: safeAuthorizationFailure(error),
      }),
    )

    return { attemptId: attempt.id }
  }

  respond(payload = {}) {
    const input = objectInput(payload)
    assertOnlyKeys(input, ["attemptId", "promptId", "action", "value"])
    const attempt = this.#attempt(requiredString(input, "attemptId", { maxLength: MAX_ID_CHARS }))
    const promptId = requiredString(input, "promptId", { maxLength: MAX_ID_CHARS })
    const action = requiredString(input, "action", { maxLength: 16 })
    const pending = attempt.prompt
    if (pending === undefined || pending.id !== promptId) {
      throw new RpcInputError("The authorization prompt is no longer active")
    }

    if (action === "answer") {
      const value = requiredString(input, "value", {
        allowEmpty: true,
        maxLength: MAX_ANSWER_CHARS,
      })
      const answer = pending.mapAnswer(value)
      this.#closePrompt(attempt, pending)
      pending.resolve(answer)
      return { accepted: true }
    }
    if (action === "decline") {
      this.#closePrompt(attempt, pending)
      pending.reject(new AuthorizationDeclinedError())
      return { accepted: true }
    }
    throw new RpcInputError("Unknown prompt response action")
  }

  cancel(payload = {}) {
    const input = objectInput(payload)
    assertOnlyKeys(input, ["attemptId"])
    const attempt = input.attemptId === undefined
      ? undefined
      : this.#attempt(requiredString(input, "attemptId", { maxLength: MAX_ID_CHARS }))
    if (attempt?.done === true) return { accepted: false }
    const cancel = () => {
      if (attempt !== undefined) {
        attempt.controller.abort("cancelled by the interaction surface")
        this.#rejectPrompt(attempt, new Error("authorization cancelled"))
      }
      this.#authorization.cancel(CODEX_AUTHORIZATION_KEY)
    }
    if (this.#commitTracker?.tryCancel(cancel) === false) {
      return { accepted: false, reason: "commit-in-progress" }
    }
    if (this.#commitTracker === undefined) cancel()
    return { accepted: true }
  }

  async logout(payload = {}) {
    const input = objectInput(payload)
    assertOnlyKeys(input, [])
    for (const attempt of this.#attempts.values()) {
      if (attempt.done) continue
      attempt.controller.abort("signed out by the interaction surface")
      this.#rejectPrompt(attempt, new Error("authorization signed out"))
    }
    this.#authorization.cancel(CODEX_AUTHORIZATION_KEY)
    await this.#credentials.deleteRecord(CODEX_AUTHORIZATION_KEY)
    return { signedOut: true }
  }

  async usage(payload = {}, signal) {
    const input = objectInput(payload)
    assertOnlyKeys(input, [])
    if (this.#accountUsageReader?.read === undefined) {
      throw new RpcInputError("Codex account usage is unavailable")
    }
    return this.#accountUsageReader.read({ signal })
  }

  dispatch(endpoint, payload, signal) {
    switch (endpoint) {
      case "status": return this.status(payload, signal)
      case "start": return this.start(payload)
      case "respond": return this.respond(payload)
      case "cancel": return this.cancel(payload)
      case "logout": return this.logout(payload)
      case "usage": return this.usage(payload, signal)
      default: throw new RpcInputError("Unknown dsh-codex RPC endpoint")
    }
  }

  dispose() {
    if (this.#closed) return
    this.#closed = true
    const cancel = () => {
      for (const attempt of this.#attempts.values()) {
        if (!attempt.done) attempt.controller.abort("authorization bridge disposed")
      }
      this.#authorization.cancel(CODEX_AUTHORIZATION_KEY)
    }
    // A disposed interaction surface may detach from an irreversible commit,
    // but must not make AuthorizationService report that commit as cancelled.
    if (this.#commitTracker === undefined) cancel()
    else this.#commitTracker.tryCancel(cancel)
    for (const attempt of this.#attempts.values()) {
      if (attempt.cleanup !== undefined) clearTimeout(attempt.cleanup)
      this.#rejectPrompt(attempt, new Error("authorization bridge disposed"))
      wakeAttempt(attempt)
    }
    this.#attempts.clear()
  }

  async #publicStatus() {
    const entry = this.#authorization.describe(CODEX_AUTHORIZATION_KEY)
    const credential = await describeCodexCredential(this.#credentials)
    return {
      flow: entry === undefined ? undefined : {
        key: CODEX_AUTHORIZATION_KEY,
        label: boundedText(entry.label, MAX_MESSAGE_CHARS),
        methods: entry.methods
          .filter(({ id }) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_CHARS)
          .slice(0, MAX_METHODS)
          .map(({ id, label }) => ({ id, label: boundedText(label, MAX_MESSAGE_CHARS) })),
        inFlight: entry.inFlight,
      },
      credential,
      quota: this.#quotaObserver?.snapshot() ?? Object.freeze({ status: "unknown" }),
    }
  }

  #attempt(id) {
    const attempt = this.#attempts.get(id)
    if (attempt === undefined) throw new RpcInputError("Unknown authorization attempt")
    return attempt
  }

  #assertOpen() {
    if (this.#closed) throw new RpcInputError("Authorization bridge is closed")
  }

  #prompt(attempt, prompt) {
    if (attempt.done || attempt.controller.signal.aborted) {
      return Promise.reject(new Error("authorization attempt is no longer active"))
    }
    if (attempt.prompt !== undefined) {
      return Promise.reject(new Error("authorization flow opened overlapping prompts"))
    }
    if (prompt.signal?.aborted === true) {
      return Promise.reject(new Error("authorization prompt was already withdrawn"))
    }

    return new Promise((resolve, reject) => {
      const serialized = serializePrompt(prompt)
      const pending = {
        id: randomUUID(),
        resolve,
        reject,
        mapAnswer: serialized.mapAnswer,
        signal: prompt.signal,
        onAbort: undefined,
      }
      if (prompt.signal !== undefined) {
        pending.onAbort = () => {
          if (attempt.prompt !== pending) return
          this.#closePrompt(attempt, pending)
          reject(new Error("authorization prompt withdrawn"))
        }
        prompt.signal.addEventListener("abort", pending.onAbort, { once: true })
      }
      attempt.prompt = pending
      this.#emit(attempt, {
        type: "prompt",
        promptId: pending.id,
        prompt: serialized.prompt,
      })
    })
  }

  #closePrompt(attempt, pending) {
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener("abort", pending.onAbort)
    }
    if (attempt.prompt === pending) attempt.prompt = undefined
    this.#emit(attempt, { type: "prompt-closed", promptId: pending.id })
  }

  #rejectPrompt(attempt, error) {
    const pending = attempt.prompt
    if (pending === undefined) return
    this.#closePrompt(attempt, pending)
    pending.reject(error)
  }

  #settle(attempt, terminal) {
    if (attempt.done) return
    attempt.done = true
    this.#rejectPrompt(attempt, new Error("authorization attempt settled"))
    this.#emit(attempt, terminal)
    attempt.cleanup = setTimeout(() => {
      this.#attempts.delete(attempt.id)
    }, this.#retentionMs)
    attempt.cleanup.unref?.()
  }

  #emit(attempt, event) {
    attempt.events.push(Object.freeze({ seq: attempt.nextSeq++, ...event }))
    if (attempt.events.length > MAX_EVENTS) attempt.events.shift()
    wakeAttempt(attempt)
  }
}

export function installAuthorizationRpc(ctx, options) {
  const bridge = new CodexAuthorizationBridge({
    authorization: ctx.authorization,
    credentials: ctx.credentials,
  }, options)
  ctx.connection.rpc.handle(
    AUTHORIZATION_RPC_CHANNEL,
    createAuthorizationRpcHandler(bridge),
    { authority: "loopback" },
  )
  ctx.effect(() => () => bridge.dispose(), "dsh-codex: authorization RPC state")
  return bridge
}

export function createAuthorizationRpcHandler(bridge) {
  return async (endpoint, payload, signal) => {
    try {
      return { ok: true, value: await bridge.dispatch(endpoint, payload, signal) }
    } catch (error) {
      if (signal?.aborted === true) {
        return {
          ok: false,
          error: { code: "cancelled", message: "Request cancelled", details: {} },
        }
      }
      if (error instanceof RpcInputError) {
        return {
          ok: false,
          error: { code: "bad-request", message: error.message, details: { issues: [] } },
        }
      }
      return {
        ok: false,
        error: { code: "internal", message: "Authorization request failed", details: {} },
      }
    }
  }
}

export function registerCodexLoginCommand(ctx, options = {}) {
  const commitTracker = options.commitTracker
  ctx.commands.register({
    name: "codex-login",
    description: "管理 Codex 登录 / Manage Codex sign-in",
    input: { hint: "[status|cancel|logout]" },
    recordInput: false,
    handler: async ({ rawInput }) => {
      const action = rawInput.trim()
      try {
        if (action === "cancel") {
          const cancel = () => ctx.authorization.cancel(CODEX_AUTHORIZATION_KEY)
          if (commitTracker?.tryCancel(cancel) === false) {
            return {
              kind: "success",
              text: "Codex 凭据已开始提交，当前无法取消；请稍候检查登录状态。 / Codex credential commit has started and can no longer be cancelled; check sign-in status shortly.",
            }
          }
          if (commitTracker === undefined) cancel()
          return {
            kind: "success",
            text: "已请求取消 Codex 登录。请在 Codex 设置页重试。 / Codex sign-in cancellation requested. Retry from Codex Settings.",
          }
        }
        if (action === "logout") {
          ctx.authorization.cancel(CODEX_AUTHORIZATION_KEY)
          await ctx.credentials.deleteRecord(CODEX_AUTHORIZATION_KEY)
          return {
            kind: "success",
            text: "已退出 Codex 登录。 / Signed out of Codex.",
          }
        }
        if (action !== "" && action !== "status") {
          return {
            kind: "error",
            text: "用法：/codex-login [status|cancel|logout] / Usage: /codex-login [status|cancel|logout]",
          }
        }

        const flow = ctx.authorization.describe(CODEX_AUTHORIZATION_KEY)
        const credential = await describeCodexCredential(ctx.credentials)
        if (flow?.inFlight === true) {
          return {
            kind: "success",
            text: "Codex 登录正在进行；请在 Codex 设置页继续。 / Codex sign-in is in progress; continue in Codex Settings.",
          }
        }
        if (credential.state === "signed-in") {
          return {
            kind: "success",
            text: "Codex 已登录。 / Codex is signed in.",
          }
        }
        if (credential.state === "invalid") {
          return {
            kind: "success",
            text: "已保存的 Codex 凭据无效；请重新登录或退出后重试。 / The saved Codex credential is invalid; sign in again or sign out before retrying.",
          }
        }
        return {
          kind: "success",
          text: flow === undefined
            ? "Codex 登录当前不可用。 / Codex sign-in is currently unavailable."
            : "Codex 尚未登录；请打开 Codex 设置页。 / Codex is not signed in; open Codex Settings.",
        }
      } catch {
        return {
          kind: "error",
          text: "Codex 登录操作失败，请在设置页重试。 / Codex sign-in action failed. Retry from Settings.",
        }
      }
    },
  })
}

async function describeCodexCredential(credentials) {
  const description = await credentials.describeRecord(CODEX_AUTHORIZATION_KEY)
  let state = "signed-out"
  if (description.configured === true) {
    if (description.kind !== "grant") {
      state = "invalid"
    } else {
      try {
        const credential = await createCodexCredentialStore(credentials).read(CODEX_PROVIDER_ID)
        state = credential === undefined ? "signed-out" : "signed-in"
      } catch {
        state = "invalid"
      }
    }
  }
  return {
    configured: description.configured === true,
    state,
    ...(description.kind === undefined ? {} : { kind: description.kind }),
    writable: description.writable === true,
  }
}

export function registerCodexUsageCommand(ctx, quotaObserver, options = {}) {
  const accountUsageReader = options?.accountUsageReader
  ctx.commands.register({
    name: "codex-usage",
    description: "查看或刷新 Codex 额度状态 / Show or refresh Codex quota state",
    input: { hint: "[status|refresh]" },
    recordInput: false,
    handler: async ({ rawInput, signal }) => {
      const action = rawInput.trim()
      if (action !== "" && action !== "status" && action !== "refresh") {
        return {
          kind: "error",
          text: "用法：/codex-usage [status|refresh] / Usage: /codex-usage [status|refresh]",
        }
      }

      if (action === "refresh") {
        if (accountUsageReader?.read === undefined || typeof accountUsageReader.read !== "function") {
          return {
            kind: "error",
            text: "Codex 账户额度刷新当前不可用。 / Codex account usage refresh is currently unavailable.",
          }
        }
        try {
          const usage = await accountUsageReader.read({ signal })
          return {
            kind: "success",
            text: formatAccountUsageSnapshot(usage),
          }
        } catch {
          return {
            kind: "error",
            text: "暂时无法刷新 Codex 账户额度。 / We are temporarily unable to refresh Codex account usage.",
          }
        }
      }

      try {
        return {
          kind: "success",
          text: formatQuotaSnapshot(quotaObserver.snapshot()),
        }
      } catch {
        return {
          kind: "error",
          text: "暂时无法读取 Codex 额度观测。 / Codex quota observation is temporarily unavailable.",
        }
      }
    },
  })
}

function formatAccountUsageSnapshot(snapshot) {
  if (
    snapshot === null
    || typeof snapshot !== "object"
    || Array.isArray(snapshot)
    || !Array.isArray(snapshot.rateLimits)
  ) {
    throw new TypeError("account usage snapshot is invalid")
  }

  const observedAt = usageTimestamp(snapshot.observedAt, "observedAt")
  const rateLimits = snapshot.rateLimits.slice(0, MAX_USAGE_SUMMARY_LIMITS)
  const lines = ["Codex 账户额度 / Codex account usage"]

  for (const [index, limit] of rateLimits.entries()) {
    if (limit === null || typeof limit !== "object" || Array.isArray(limit)) {
      throw new TypeError("account usage rate limit is invalid")
    }
    if (index > 0) {
      const label = safeUsageLabel(limit.limitName)
      const suffix = label === undefined ? "" : `（${label}） / Additional limit ${index} (${label})`
      lines.push(label === undefined
        ? `附加额度 ${index} / Additional limit ${index}`
        : `附加额度 ${index}${suffix}`)
    }

    const windows = [limit.primary, limit.secondary].filter((window) => window !== undefined)
    if (windows.length === 0) {
      lines.push("- 暂无可显示的额度窗口。 / No displayable quota window is available.")
      continue
    }
    for (const window of windows) lines.push(formatAccountUsageWindow(window))
  }

  if (rateLimits.length === 0) {
    lines.push("暂无可显示的额度窗口。 / No displayable quota window is available.")
  }
  if (snapshot.rateLimits.length > rateLimits.length) {
    const omitted = snapshot.rateLimits.length - rateLimits.length
    lines.push(`另有 ${omitted} 项附加额度未展开。 / ${omitted} additional limit${omitted === 1 ? "" : "s"} omitted.`)
  }
  lines.push(`数据更新时间：${observedAt} / Updated at: ${observedAt}`)
  return lines.join("\n")
}

function formatAccountUsageWindow(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("account usage window is invalid")
  }
  const usedPercent = value.usedPercent
  if (
    typeof usedPercent !== "number"
    || !Number.isFinite(usedPercent)
    || usedPercent < 0
    || usedPercent > 100
  ) {
    throw new TypeError("account usage percentage is invalid")
  }
  if (
    !Number.isSafeInteger(value.windowDurationMins)
    || value.windowDurationMins < 1
    || value.windowDurationMins > MAX_USAGE_WINDOW_MINS
  ) {
    throw new TypeError("account usage window duration is invalid")
  }
  const resetsAt = usageTimestamp(value.resetsAt, "resetsAt")
  const used = concisePercent(usedPercent)
  const remaining = concisePercent(Math.max(0, 100 - usedPercent))
  const label = usageWindowLabel(value.windowDurationMins)
  return `- ${label.zh}：已使用 ${used}%，剩余 ${remaining}%；重置时间：${resetsAt} / ${label.en}: ${used}% used, ${remaining}% remaining; resets at: ${resetsAt}`
}

function usageWindowLabel(windowDurationMins) {
  if (windowDurationMins === 300) return { zh: "5 小时额度", en: "5-hour limit" }
  if (windowDurationMins === 10_080) return { zh: "每周额度", en: "Weekly limit" }
  return {
    zh: `${windowDurationMins} 分钟额度`,
    en: `${windowDurationMins}-minute limit`,
  }
}

function concisePercent(value) {
  return String(Math.round(value * 10) / 10)
}

function usageTimestamp(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
    throw new TypeError(`account usage ${name} is invalid`)
  }
  return new Date(value).toISOString()
}

function safeUsageLabel(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_USAGE_LABEL_CHARS
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined
  }
  return value
}

function formatQuotaSnapshot(snapshot) {
  if (snapshot.status === "recent-success") {
    return `最近一次 Codex 请求成功于 ${new Date(snapshot.observedAt).toISOString()}；这不代表账户剩余额度。 / Last Codex request succeeded at ${new Date(snapshot.observedAt).toISOString()}; this does not represent remaining account quota.`
  }
  if (snapshot.status === "exhausted") {
    if (snapshot.resetAt === undefined) {
      return "最近观测到 Codex 账户额度耗尽，但未获得通过校验的重置时间。 / Codex account quota was exhausted in the latest observation, but no reset time passed validation."
    }
    const reset = new Date(snapshot.resetAt).toISOString()
    return `最近观测到 Codex 账户额度耗尽；观测到的重置时间：${reset}。 / Codex account quota was exhausted in the latest observation; observed reset time: ${reset}.`
  }
  return "暂无近期 Codex 额度观测；插件不会调用未公开的账户额度接口。 / No recent Codex quota observation; the plugin does not call undocumented account-quota endpoints."
}

function objectInput(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RpcInputError("RPC payload must be an object")
  }
  return value
}

function requiredString(value, key, options = {}) {
  const field = value[key]
  if (typeof field !== "string" || (!options.allowEmpty && field.length === 0)) {
    throw new RpcInputError(`${key} must be a ${options.allowEmpty ? "string" : "non-empty string"}`)
  }
  if (options.maxLength !== undefined && field.length > options.maxLength) {
    throw new RpcInputError(`${key} is too long`)
  }
  return field
}

function optionalString(value, key, options) {
  if (value[key] === undefined) return undefined
  return requiredString(value, key, options)
}

function assertOnlyKeys(value, allowed) {
  const keys = new Set(allowed)
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new RpcInputError("RPC payload contains an unknown field")
  }
}

function optionalSequence(value) {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RpcInputError("after must be a non-negative safe integer")
  }
  return value
}

function serializeNotice(notice) {
  const url = safeAuthorizationUrl(notice.url)
  return {
    message: boundedText(notice.message, MAX_MESSAGE_CHARS),
    ...(url === undefined ? {} : { url }),
    ...(notice.code === undefined ? {} : { code: boundedText(notice.code, MAX_CODE_CHARS) }),
  }
}

function serializePrompt(prompt) {
  if (prompt.kind === "select") {
    const answers = new Map()
    const options = prompt.options.slice(0, MAX_OPTIONS).map((option, index) => {
      const id = `option-${index + 1}`
      answers.set(id, String(option.id))
      return {
        id,
        label: boundedText(option.label, MAX_MESSAGE_CHARS),
        ...(option.description === undefined
          ? {}
          : { description: boundedText(option.description, MAX_MESSAGE_CHARS) }),
      }
    })
    return {
      prompt: {
        kind: "select",
        message: boundedText(prompt.message, MAX_MESSAGE_CHARS),
        options,
      },
      mapAnswer: (answer) => {
        const selected = answers.get(answer)
        if (selected === undefined) throw new RpcInputError("Unknown prompt option")
        return selected
      },
    }
  }
  return {
    prompt: {
      kind: prompt.kind === "secret" ? "secret" : "text",
      message: boundedText(prompt.message, MAX_MESSAGE_CHARS),
      ...(prompt.placeholder === undefined
        ? {}
        : { placeholder: boundedText(prompt.placeholder, MAX_PLACEHOLDER_CHARS) }),
    },
    mapAnswer: (answer) => answer,
  }
}

function boundedText(value, maxLength) {
  const text = String(value)
  return text.length <= maxLength ? text : text.slice(0, maxLength)
}

function safeAuthorizationUrl(value) {
  if (value === undefined) return undefined
  const text = String(value)
  if (text.length === 0 || text.length > MAX_URL_CHARS) return undefined
  try {
    const url = new URL(text)
    if (url.username !== "" || url.password !== "") return undefined
    if (url.protocol === "https:") return url.href
    if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost"
    || hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
}

function safeAuthorizationFailure(error) {
  const candidate = typeof error?.code === "string" ? error.code : "AUTHORIZATION_FAILED"
  const code = /^[A-Z0-9_-]{1,64}$/u.test(candidate) ? candidate : "AUTHORIZATION_FAILED"
  return { code, message: "Authorization failed" }
}

function waitForAttempt(attempt, after, signal, waitMs) {
  if (attempt.done || attempt.events.some((event) => event.seq > after)) return Promise.resolve()
  if (signal?.aborted === true) return Promise.reject(signal.reason ?? new Error("request cancelled"))
  if (attempt.waiters.size >= MAX_WAITERS_PER_ATTEMPT) {
    return Promise.reject(new RpcInputError("Too many status waiters"))
  }
  return new Promise((resolve, reject) => {
    let timer
    const finish = (error) => {
      attempt.waiters.delete(wake)
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const wake = () => finish()
    const abort = () => finish(signal.reason ?? new Error("request cancelled"))
    attempt.waiters.add(wake)
    signal?.addEventListener("abort", abort, { once: true })
    timer = setTimeout(wake, waitMs)
    timer.unref?.()
  })
}

function wakeAttempt(attempt) {
  for (const wake of [...attempt.waiters]) wake()
}
