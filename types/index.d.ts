import type { Context } from "@deepseek-ai/cordis"
import type Schema from "@deepseek-ai/schemastery"

export interface Config {
  partialResponseRecovery?: boolean
  models?: Array<{
    id: string
    name?: string
    contextWindow?: number
    maxTokens?: number
  }>
  cacheRetention?: "none" | "short" | "long"
  streamIdleTimeoutMs?: number
  maxRequestImageBytes?: number
  requestImagePixelBudget?: number
  requestImageMaxBytes?: number
}

export declare const name: "dsh-codex"
export declare const inject: readonly ["llm", "authorization", "credentials"]
export declare const Config: Schema<Config>
export declare function apply(ctx: Context, config?: Config): void
