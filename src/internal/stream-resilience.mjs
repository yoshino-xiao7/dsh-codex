import { normalizeCodexFailure } from "./failure-normalizer.mjs"
import { CODEX_ROUTE_ID } from "./codex-identifiers.mjs"

const PARTIAL_RECOVERABLE_CODES = new Set([
  "QUOTA",
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
  "EMPTY_RESPONSE",
  "QUOTA_OR_RATE_LIMIT",
])

const SUCCESSFUL_FINISH_KINDS = new Set(["stop", "tool-calls", "max-tokens"])

const DIRECTLY_HANDLED_FAILURE_KINDS = new Set([
  "account-quota",
  "ambiguous-limit",
  "transport",
])

function createTracker() {
  return {
    blocks: new Map(),
    indexes: new Set(),
    hasVisibleText: false,
    hasToolCall: false,
  }
}

function rememberChunk(tracker, chunk) {
  if ("index" in chunk && Number.isSafeInteger(chunk.index)) tracker.indexes.add(chunk.index)
  switch (chunk.type) {
    case "block-start":
      tracker.blocks.set(chunk.index, {
        type: chunk.blockType,
        text: "",
        open: true,
      })
      if (chunk.blockType === "tool-call") tracker.hasToolCall = true
      break
    case "text-delta": {
      const block = tracker.blocks.get(chunk.index)
      if (block?.type === "text") block.text += chunk.text
      if (chunk.text.length > 0) tracker.hasVisibleText = true
      break
    }
    case "reasoning-delta": {
      const block = tracker.blocks.get(chunk.index)
      if (block?.type === "reasoning") block.text += chunk.text
      break
    }
    case "tool-call-delta":
      tracker.hasToolCall = true
      break
    case "block-end": {
      const block = tracker.blocks.get(chunk.index)
      if (block !== undefined) {
        block.open = false
        if (chunk.block.type === "text") {
          block.text = chunk.block.text
          if (chunk.block.text.length > 0) tracker.hasVisibleText = true
        }
      }
      if (chunk.block.type === "tool-call") tracker.hasToolCall = true
      break
    }
  }
}

function safeToRecover(tracker) {
  if (!tracker.hasVisibleText || tracker.hasToolCall) return false
  for (const block of tracker.blocks.values()) {
    if (!block.open) continue
    if (block.type !== "text" && block.type !== "reasoning") return false
  }
  return true
}

function nextIndex(tracker) {
  if (tracker.indexes.size === 0) return 0
  const index = Math.max(...tracker.indexes) + 1
  if (!Number.isSafeInteger(index)) throw new RangeError("no safe block index remains for recovery notice")
  return index
}

function closeOpenTextBlocks(tracker) {
  const chunks = []
  for (const [index, block] of tracker.blocks) {
    if (!block.open) continue
    chunks.push({
      type: "block-end",
      index,
      block: { type: block.type, text: block.text },
    })
    block.open = false
  }
  return chunks
}

function recoveryNotice(normalized) {
  if (normalized.failure.code === "QUOTA") {
    return `⚠️ ${normalized.failure.message} 已保存上方未完成回复。 / The partial response above was preserved.`
  }
  return "⚠️ 回复流在完成前中断。为避免重复输出或工具副作用，本插件没有重放整次请求，并已保存上方内容；请发送“继续”。 / The response stream was interrupted. The full request was not replayed; send “continue” to resume."
}

function recoveredChunks(tracker, normalized) {
  const chunks = closeOpenTextBlocks(tracker)
  const index = nextIndex(tracker)
  const text = recoveryNotice(normalized)
  chunks.push(
    { type: "block-start", index, blockType: "text" },
    { type: "text-delta", index, text },
    { type: "block-end", index, block: { type: "text", text } },
  )
  return chunks
}

function partialFailure(failure) {
  return Object.freeze({
    message: "Codex 在产生部分输出后失败；已禁用整次请求重放，以避免重复输出或工具副作用。 / Codex failed after partial output; full-request replay was disabled to prevent duplicate output or tool side effects.",
    code: "PARTIAL_RESPONSE",
  })
}

function prematureEndFailure() {
  return Object.freeze({
    message: "Codex stream ended before a terminal finish chunk",
    code: "TRANSPORT",
  })
}

function* finishWithFailure({
  tracker,
  chunk,
  pendingUsage,
  options,
  config,
  partialResponseRecovery,
}) {
  const normalized = normalizeCodexFailure(chunk.reason.failure)
  const failure = normalized.failure
  if (failure.code === "QUOTA") {
    notify(config.onQuota, {
      provider: options.provider,
      model: options.model,
      ...(normalized.facts.reset?.epochMs === undefined
        ? {}
        : { resetAt: normalized.facts.reset.epochMs }),
    })
  }
  const canRecover = partialResponseRecovery
    && PARTIAL_RECOVERABLE_CODES.has(failure.code)
    && safeToRecover(tracker)

  if (canRecover) {
    yield* recoveredChunks(tracker, normalized)
    if (pendingUsage !== undefined) yield pendingUsage
    notify(config.onRecovery, {
      provider: options.provider,
      model: options.model,
      code: failure.code,
      requestId: failure.requestId,
    })
    yield { type: "finish", reason: { kind: "stop" } }
    return
  }

  if (pendingUsage !== undefined) yield pendingUsage
  const finalFailure = failure.code !== "QUOTA"
    && (tracker.hasVisibleText || tracker.hasToolCall)
    && PARTIAL_RECOVERABLE_CODES.has(failure.code)
    ? partialFailure(failure)
    : failure
  yield {
    ...chunk,
    reason: { kind: "error", failure: finalFailure },
  }
}

function notify(callback, detail) {
  if (typeof callback !== "function") return
  try {
    callback(Object.freeze(detail))
  } catch {
    // Observation hooks must never turn a completed provider stream into a failure.
  }
}

/**
 * Stabilize one Codex stream without replaying a request that already emitted
 * content. Safe text is closed and persisted; tool-bearing streams fail closed.
 */
export async function* stabilizeCodexStream(options, next, config = {}) {
  if (options?.provider !== CODEX_ROUTE_ID) {
    yield* next()
    return
  }

  const tracker = createTracker()
  const partialResponseRecovery = config.partialResponseRecovery !== false
  let pendingUsage

  try {
    for await (const chunk of next()) {
      if (chunk.type === "usage") {
        if (pendingUsage !== undefined) yield pendingUsage
        pendingUsage = chunk
        continue
      }

      if (chunk.type !== "finish") {
        if (pendingUsage !== undefined) {
          yield pendingUsage
          pendingUsage = undefined
        }
        rememberChunk(tracker, chunk)
        yield chunk
        continue
      }

      if (chunk.reason.kind !== "error") {
        if (pendingUsage !== undefined) yield pendingUsage
        if (SUCCESSFUL_FINISH_KINDS.has(chunk.reason.kind)) {
          notify(config.onSuccess, {
            provider: options.provider,
            model: options.model,
          })
        }
        yield chunk
        return
      }

      yield* finishWithFailure({
        tracker,
        chunk,
        pendingUsage,
        options,
        config,
        partialResponseRecovery,
      })
      return
    }
  } catch (failure) {
    const normalized = normalizeCodexFailure(failure)
    if (!DIRECTLY_HANDLED_FAILURE_KINDS.has(normalized.facts.kind)) throw failure
    yield* finishWithFailure({
      tracker,
      chunk: {
        type: "finish",
        reason: { kind: "error", failure },
      },
      pendingUsage,
      options,
      config,
      partialResponseRecovery,
    })
    return
  }

  yield* finishWithFailure({
    tracker,
    chunk: {
      type: "finish",
      reason: { kind: "error", failure: prematureEndFailure() },
    },
    pendingUsage,
    options,
    config,
    partialResponseRecovery,
  })
}
