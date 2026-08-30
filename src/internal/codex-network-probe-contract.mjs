export const CODEX_NETWORK_PROBE_SESSION_PREFIX = "__dsh-codex-network-probe__:"
export const CODEX_NETWORK_PROBE_PREFERENCES = Object.freeze({
  fast: false,
  transport: "sse",
  textVerbosity: "low",
  reasoningSummary: "off",
})

const CODEX_NETWORK_PROBE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u

export function isCodexNetworkProbeModelId(value) {
  return typeof value === "string" && CODEX_NETWORK_PROBE_MODEL_ID.test(value)
}

export function isCodexNetworkProbeSession(sessionId) {
  return typeof sessionId === "string"
    && sessionId.startsWith(CODEX_NETWORK_PROBE_SESSION_PREFIX)
}
