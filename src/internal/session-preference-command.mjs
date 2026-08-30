const USAGE = "用法：/codex [status|reset|set fast on|off|set transport auto|sse|websocket|websocket-cached|set verbosity low|medium|high|set summary auto|concise|detailed|off] / Usage: /codex [status|reset|set fast on|off|set transport auto|sse|websocket|websocket-cached|set verbosity low|medium|high|set summary auto|concise|detailed|off]"
const TRANSPORTS = new Set(["auto", "sse", "websocket", "websocket-cached"])
const TEXT_VERBOSITIES = new Set(["low", "medium", "high"])
const REASONING_SUMMARIES = new Set(["auto", "concise", "detailed", "off"])

/** Register the TUI/Web command surface for process-local session preferences. */
export function registerCodexSessionCommand(ctx, preferences, options = {}) {
  const resetSession = options.resetSession ?? (() => undefined)
  if (typeof resetSession !== "function") throw new TypeError("resetSession must be a function")
  return ctx.commands.register({
    name: "codex",
    description: "管理当前会话的 Codex 请求偏好 / Manage Codex request preferences for this session",
    input: { hint: "[status|reset|set fast on|off|set transport ...|set verbosity ...|set summary ...]" },
    recordInput: false,
    handler: async ({ rawInput, agent }) => {
      const parts = String(rawInput).trim().split(/\s+/u).filter(Boolean)
      const action = parts.length === 0 ? ["status"] : parts
      try {
        if (action.length === 1 && action[0] === "status") {
          return success(preferences.resolve(String(agent.id)))
        }
        if (action.length === 1 && action[0] === "reset") {
          const sessionId = String(agent.id)
          preferences.remove(sessionId)
          resetSession(sessionId)
          return success(preferences.resolve(sessionId), "已重置当前会话。 / Session preferences reset. ")
        }
        if (action.length === 3 && action[0] === "set" && action[1] === "fast") {
          if (action[2] !== "on" && action[2] !== "off") return { kind: "error", text: USAGE }
          return success(preferences.configure(String(agent.id), { fast: action[2] === "on" }))
        }
        if (action.length === 3 && action[0] === "set" && action[1] === "transport") {
          if (!TRANSPORTS.has(action[2])) return { kind: "error", text: USAGE }
          const sessionId = String(agent.id)
          const snapshot = preferences.configure(sessionId, { transport: action[2] })
          resetSession(sessionId)
          return success(snapshot)
        }
        if (action.length === 3 && action[0] === "set" && action[1] === "verbosity") {
          if (!TEXT_VERBOSITIES.has(action[2])) return { kind: "error", text: USAGE }
          return success(preferences.configure(String(agent.id), { textVerbosity: action[2] }))
        }
        if (action.length === 3 && action[0] === "set" && action[1] === "summary") {
          if (!REASONING_SUMMARIES.has(action[2])) return { kind: "error", text: USAGE }
          return success(preferences.configure(String(agent.id), { reasoningSummary: action[2] }))
        }
        return { kind: "error", text: USAGE }
      } catch {
        return {
          kind: "error",
          text: "Codex 会话偏好暂时不可用。 / Codex session preferences are temporarily unavailable.",
        }
      }
    },
  })
}

function success(snapshot, prefix = "") {
  const fast = snapshot.fast ? "on" : "off"
  const fastZh = snapshot.fast ? "开启" : "关闭"
  return {
    kind: "success",
    text: `${prefix}Fast: ${fast} · Transport: ${snapshot.transport} · Text verbosity: ${snapshot.textVerbosity} · Reasoning summary: ${snapshot.reasoningSummary} / Fast：${fastZh} · 传输：${snapshot.transport} · 回复详细度：${snapshot.textVerbosity} · 推理摘要：${snapshot.reasoningSummary}`,
  }
}
