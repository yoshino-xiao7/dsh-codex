import {
  installAuthorizationRpc,
  registerCodexLoginCommand,
  registerCodexUsageCommand,
} from "../internal/authorization-bridge.mjs"
import { createAuthorizationCommitTracker } from "../internal/authorization-commit-tracker.mjs"
import {
  Config,
  installCodexProviderRuntime,
} from "../internal/codex-provider-runtime.mjs"
import { createQuotaObserver } from "../internal/quota-observer.mjs"
import { createReadImageUrlMiddleware } from "../internal/remote-image-input.mjs"
import { createCodexSessionResourceManager } from "../internal/codex-session-resources.mjs"
import { registerCodexSessionCommand } from "../internal/session-preference-command.mjs"
import { registerSessionPreferenceRpc } from "../internal/session-preference-bridge.mjs"
import { createSessionPreferences } from "../internal/session-preferences.mjs"
import { stabilizeCodexStream } from "../internal/stream-resilience.mjs"

export const name = "dsh-codex"
export const inject = ["llm", "authorization", "credentials"]

export { Config }

export function apply(ctx, config = {}) {
  const entry = Config(config)
  const authorizationCommitTracker = createAuthorizationCommitTracker()
  const sessionPreferences = createSessionPreferences({ defaultTransport: "auto" })
  const sessionResources = createCodexSessionResourceManager()
  const runtime = installCodexProviderRuntime(ctx, entry, {
    authorizationCommitTracker,
    sessionPreferences,
    sessionResources,
  })
  ctx.effect(
    () => () => {
      try {
        sessionPreferences.dispose()
      } finally {
        sessionResources.dispose()
      }
    },
    "dsh-codex: session resources",
  )
  ctx.on(
    "agent/disposed",
    ({ agent }) => {
      const sessionId = String(agent.id)
      try {
        sessionPreferences.remove(sessionId)
      } finally {
        sessionResources.reset(sessionId)
      }
    },
    { global: true },
  )
  const quotaObserver = createQuotaObserver()
  ctx.on(
    "llm/stream",
    (options, next) => stabilizeCodexStream(options, next, {
      partialResponseRecovery: runtime.getConfig().partialResponseRecovery,
      onQuota: ({ resetAt }) => quotaObserver.observeQuota({
        observedAt: Date.now(),
        ...(resetAt === undefined ? {} : { resetAt }),
      }),
      onSuccess: () => quotaObserver.observeSuccess(Date.now()),
      onRecovery: ({ model, code, requestId }) => {
        const request = requestId === undefined ? "" : ` request=${requestId}`
        ctx.logger.warn(`dsh-codex: preserved partial ${model} response after ${code}; full-request replay disabled${request}`)
      },
    }),
    { global: true },
  )

  ctx.inject(["connection"], (connectionCtx) => {
    installAuthorizationRpc(connectionCtx, {
      accountUsageReader: runtime.accountUsageReader,
      commitTracker: authorizationCommitTracker,
      quotaObserver,
    })
    registerSessionPreferenceRpc(connectionCtx, sessionPreferences)
  })
  ctx.inject(["commands"], (commandCtx) => {
    registerCodexSessionCommand(commandCtx, sessionPreferences, {
      resetSession: (sessionId) => sessionResources.reset(sessionId),
    })
    registerCodexLoginCommand(commandCtx, { commitTracker: authorizationCommitTracker })
    registerCodexUsageCommand(commandCtx, quotaObserver)
  })
  ctx.inject(["tools", "attachments"], (imageCtx) => {
    const middleware = createReadImageUrlMiddleware(imageCtx)
    imageCtx.on(
      "tools/execute",
      middleware,
      { global: true },
    )
    imageCtx.effect(
      () => () => middleware.dispose(),
      "dsh-codex: remote image work",
    )
  })
}
