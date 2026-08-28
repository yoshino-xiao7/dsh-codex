import type { Context } from "@deepseek-ai/cordis"
import type { GenerateOptions, LlmFailure, StreamChunk } from "@deepseek-ai/dsh-llm"

import {
  Config as ConfigSchema,
  apply as applyHost,
  inject as hostInject,
  name as hostName,
} from "dsh-codex-community"
import type { Config as HostConfig } from "dsh-codex-community"
import {
  AuthorizationSettings,
  CodexSettings,
  createAuthorizationClient,
  createModelEnablementClient,
} from "dsh-codex-community/client"
import type {
  AuthorizationClient,
  RpcConnection,
} from "dsh-codex-community/client"
import {
  inspectCodexFailure,
  createQuotaObserver,
  normalizeCodexFailure,
  resolveImagePolicy,
  stabilizeCodexStream,
  toAttachmentRequestPolicy,
} from "dsh-codex-community/reliability"

declare const ctx: Context
declare const connection: RpcConnection
declare const options: GenerateOptions
declare const failure: LlmFailure
declare const next: () => AsyncIterable<StreamChunk>

const config: HostConfig = { partialResponseRecovery: true }
applyHost(ctx, config)
ConfigSchema(config)

const client: AuthorizationClient = createAuthorizationClient(connection)
const modelClient = createModelEnablementClient(connection)
void client.describe()
AuthorizationSettings({ client, t: (key) => key })
CodexSettings({ client, modelClient, t: (key) => key })

const facts = inspectCodexFailure(failure)
const quota = createQuotaObserver({ staleMs: 300_000 })
const normalized = normalizeCodexFailure(failure)
const imagePolicy = resolveImagePolicy()
const attachmentPolicy = toAttachmentRequestPolicy(imagePolicy)
const stream: AsyncIterable<StreamChunk> = stabilizeCodexStream(options, next)

void [
  hostName,
  hostInject,
  facts.kind,
  quota.snapshot().status,
  normalized.changed,
  attachmentPolicy.maxPixels,
  stream,
]
