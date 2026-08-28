import {
  CODEX_CREDENTIAL_KEY,
  CODEX_PROVIDER_ID,
} from "./codex-credential-store.mjs"

const MAX_MESSAGE_CHARS = 2_048
const MAX_PLACEHOLDER_CHARS = 512
const MAX_CODE_CHARS = 256
const MAX_URL_CHARS = 2_048
const MAX_OPTIONS = 64

/** Register the sole OAuth flow that writes the plugin-owned Codex grant. */
export function registerCodexAuthorizationFlow({
  ownerContext,
  authorization,
  credentialStore,
  authContext,
  provider,
  commitTracker,
}) {
  void authContext
  if (provider?.id !== CODEX_PROVIDER_ID || provider.auth?.oauth === undefined) {
    throw new TypeError("provider must be the OAuth-capable Codex provider")
  }

  let closing = false
  const flow = {
    key: CODEX_CREDENTIAL_KEY,
    label: "Codex (ChatGPT OAuth)",
    methods: [{ id: "oauth", label: "使用 ChatGPT 登录 / Sign in with ChatGPT" }],
    async run(session) {
      if (closing) {
        await waitForAbort(session.signal)
        return
      }
      const trackedAttempt = commitTracker?.begin()
      try {
        const credential = await provider.auth.oauth.login({
          signal: session.signal,
          notify(event) {
            const notice = authorizationNotice(event)
            if (notice !== undefined) session.notify(notice)
          },
          prompt(prompt) {
            return session.prompt(authorizationPrompt(prompt))
          },
        })
        if (session.signal.aborted) return

        // The serialized mutate callback is the cancellation linearization point.
        // Before it selects a replacement, abort is a no-op. After it selects one,
        // this write owns the lock and must finish: a later compensating delete
        // cannot distinguish this attempt from a sign-in already queued by another
        // DSH process and could erase that newer grant. The tracker lets plugin
        // surfaces reject a too-late cancel until authorization/settled fires.
        await credentialStore.modify(CODEX_PROVIDER_ID, () => {
          if (session.signal.aborted) return undefined
          if (trackedAttempt !== undefined && !trackedAttempt.selectCommit()) return undefined
          return credential
        })
      } finally {
        trackedAttempt?.finish()
      }
    },
  }

  const rootContext = ownerContext?.root
  if (rootContext === undefined || rootContext === ownerContext) {
    return authorization.registerFlow(flow)
  }

  // DSH rc.2 withdraws a flow and aborts its running controller in the same
  // disposer. A selected credential write is already irreversible, so keep
  // the flow under the app root and give the plugin one ordered cleanup that
  // waits for the public authorization settlement before withdrawing it.
  const rootAuthorization = rootContext.authorization
  const settlementWaiters = new Set()
  const disposeSettlementListener = rootContext.on(
    "authorization/settled",
    (key) => {
      if (key !== CODEX_CREDENTIAL_KEY) return
      commitTracker?.settle()
      for (const resolve of settlementWaiters) resolve()
      settlementWaiters.clear()
    },
    { global: true },
  )
  let disposeFlow
  let disposeLifecycle
  try {
    disposeFlow = rootAuthorization.registerFlow(flow)
    disposeLifecycle = ownerContext.effect(
      () => async () => {
        closing = true
        try {
          while (rootAuthorization.describe(CODEX_CREDENTIAL_KEY)?.inFlight === true) {
            const settled = new Promise((resolve) => { settlementWaiters.add(resolve) })
            if (commitTracker?.isCommitPending() !== true) {
              rootAuthorization.cancel(CODEX_CREDENTIAL_KEY)
            }
            await settled
          }
        } finally {
          disposeFlow()
          disposeSettlementListener()
          for (const resolve of settlementWaiters) resolve()
          settlementWaiters.clear()
        }
      },
      "dsh-codex: quiescent authorization flow",
    )
  } catch (error) {
    disposeFlow?.()
    disposeSettlementListener()
    throw error
  }
  return disposeLifecycle
}

function waitForAbort(signal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
}

function authorizationNotice(event) {
  switch (event?.type) {
    case "auth_url":
      return compact({
        message: bounded(event.instructions ?? "在浏览器中继续授权。 / Continue authorization in your browser.", MAX_MESSAGE_CHARS),
        url: safeAuthorizationUrl(event.url),
      })
    case "device_code":
      return compact({
        message: "在浏览器中继续授权。 / Continue authorization in your browser.",
        url: safeAuthorizationUrl(event.verificationUri),
        code: bounded(event.userCode, MAX_CODE_CHARS),
      })
    case "info":
      return compact({
        message: bounded(event.message, MAX_MESSAGE_CHARS),
        url: safeAuthorizationUrl(event.links?.[0]?.url),
      })
    case "progress":
      return { message: bounded(event.message, MAX_MESSAGE_CHARS) }
    default:
      return undefined
  }
}

function authorizationPrompt(prompt) {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  if (prompt.type === "select") {
    return {
      ...signal,
      kind: "select",
      message: bounded(prompt.message, MAX_MESSAGE_CHARS),
      options: prompt.options.slice(0, MAX_OPTIONS).map((option) => compact({
        id: bounded(option.id, MAX_CODE_CHARS),
        label: bounded(option.label, MAX_MESSAGE_CHARS),
        description: option.description === undefined
          ? undefined
          : bounded(option.description, MAX_MESSAGE_CHARS),
      })),
    }
  }
  return compact({
    ...signal,
    kind: prompt.type === "secret" ? "secret" : "text",
    message: bounded(prompt.message, MAX_MESSAGE_CHARS),
    placeholder: prompt.placeholder === undefined
      ? undefined
      : bounded(prompt.placeholder, MAX_PLACEHOLDER_CHARS),
  })
}

function safeAuthorizationUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_CHARS) return undefined
  try {
    const url = new URL(value)
    if (url.username !== "" || url.password !== "") return undefined
    if (url.protocol === "https:") return url.href
    if (url.protocol === "http:" && isLoopback(url.hostname)) return url.href
  } catch {
    // Invalid URLs are omitted from the neutral notice.
  }
  return undefined
}

function isLoopback(hostname) {
  return hostname === "localhost"
    || hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
}

function bounded(value, maxLength) {
  const text = String(value)
  return text.length <= maxLength ? text : text.slice(0, maxLength)
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
