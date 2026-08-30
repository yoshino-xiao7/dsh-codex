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
  ConnectionDiagnosticsSettings,
  CodexFastToggle,
  CodexSettings,
  createAuthorizationClient,
  createConnectionDiagnosticsClient,
  createModelEnablementClient,
  createSessionPreferenceClient,
} from "dsh-codex-community/client"
import type {
  CodexAccountUsage,
  AuthorizationClient,
  ConnectionDiagnosticsClient,
  RpcConnection,
  SessionPreferenceClient,
  UseCodexModelDirectory,
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
const diagnosticsClient: ConnectionDiagnosticsClient = createConnectionDiagnosticsClient(connection)
const modelClient = createModelEnablementClient(connection)
void client.describe()
void diagnosticsClient.run("local")
void diagnosticsClient.run("account")
const accountUsage: Promise<CodexAccountUsage> = client.usage()
const sessionPreferences = createSessionPreferenceClient(connection)
const sessionPreference: SessionPreferenceClient = sessionPreferences.forSession("session-1")
void sessionPreference.get()
void sessionPreference.getForModel("gpt-5.6-sol")
void sessionPreference.setFast(true)
void sessionPreference.setTransport("websocket-cached")
const useModelDirectory: UseCodexModelDirectory = (selector) => selector({
  current: { provider: "dsh-codex", model: "gpt-5.6-sol" },
})
AuthorizationSettings({ client, t: (key) => key })
ConnectionDiagnosticsSettings({ client: diagnosticsClient, t: (key) => key })
CodexFastToggle({
  session: { removed: false },
  useModelDirectory,
  preferenceClient: sessionPreference,
  selectModel: async () => undefined,
  t: (key) => key,
})
CodexSettings({ client, diagnosticsClient, modelClient, t: (key) => key })

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
  accountUsage,
  stream,
]
