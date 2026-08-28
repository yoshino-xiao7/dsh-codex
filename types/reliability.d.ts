import type { GenerateOptions, LlmFailure, StreamChunk } from "@deepseek-ai/dsh-llm"

export interface ResolvedImagePolicy {
  readonly maxRequestImageBytes: number
  readonly requestImagePixelBudget: number
  readonly requestImageMaxBytes: number
}

export interface AttachmentRequestPolicy {
  readonly maxPixels: number
  readonly maxBytes: number
}

export interface CodexFailureFacts {
  readonly kind: "account-quota" | "ambiguous-limit" | "transport" | "other"
  readonly status?: number
  readonly reset?: {
    readonly raw: string
    readonly epochMs?: number
    readonly iso?: string
  }
  readonly requestId?: string
}

export interface NormalizedCodexFailure {
  readonly changed: boolean
  readonly failure: LlmFailure
  readonly facts: CodexFailureFacts
}

export type CodexQuotaSnapshot =
  | { readonly status: "unknown" }
  | { readonly status: "recent-success"; readonly observedAt: number }
  | {
      readonly status: "exhausted"
      readonly observedAt: number
      readonly resetAt?: number
    }

export interface CodexQuotaObserver {
  observeSuccess(now: number): CodexQuotaSnapshot
  observeQuota(observation: { observedAt: number; resetAt?: number }): CodexQuotaSnapshot
  snapshot(): CodexQuotaSnapshot
}

export declare const DEFAULT_IMAGE_POLICY: ResolvedImagePolicy
export declare function resolveImagePolicy(input?: Partial<ResolvedImagePolicy>): ResolvedImagePolicy
export declare function toAttachmentRequestPolicy(input?: Partial<ResolvedImagePolicy>): AttachmentRequestPolicy
export declare function parseEmbeddedJsonObjects(text: string): Record<string, unknown>[]
export declare function inspectCodexFailure(failure: LlmFailure | unknown): CodexFailureFacts
export declare function normalizeCodexFailure(failure: LlmFailure): NormalizedCodexFailure
export declare function createQuotaObserver(options?: {
  clock?: () => number
  staleMs?: number
  maxResetHorizonMs?: number
}): CodexQuotaObserver
export declare function stabilizeCodexStream(
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
  config?: {
    partialResponseRecovery?: boolean
    onRecovery?: (detail: {
      provider: string
      model: string
      code: string
      requestId?: string
    }) => void
    onQuota?: (detail: {
      provider: string
      model: string
      resetAt?: number
    }) => void
    onSuccess?: (detail: {
      provider: string
      model: string
    }) => void
  },
): AsyncIterable<StreamChunk>
