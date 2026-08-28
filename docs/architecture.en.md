# Architecture

[简体中文](architecture.md) | [English](architecture.en.md)

## Responsibilities

This plugin registers the Codex route, settings namespace, OAuth flow, session preferences, and reliability policy. Message conversion, model protocols, tool permissions, session persistence, and OAuth protocol behavior use public interfaces from DSH, `@deepseek-ai/dsh-llm-pi-ai`, and pi-ai.

```text
DSH Web settings ── loopback RPC ── AuthorizationBridge
                                           │
                              dsh-codex/openai-codex
                                           │
                              CodexCredentialStore
                                           │
                                  ChatGPT OAuth grant

Harness Agent Loop
        │
        ├── SessionPreferences ── Fast / transport
        │
        ▼
StreamResilience ── CodexRouteAdapter (`dsh-codex`)
                              │
                              ▼
                PiAiAdapter (`openai-codex`) ── CodexPiProvider
        ▲
        └── attachment service ── ImagePolicy
```

## ProviderRuntime

`ProviderRuntime` creates the `dsh-codex` route and OAuth flow under the `dsh-codex` settings namespace. The outer `CodexRouteAdapter` maps the DSH route to PiAiAdapter's internal canonical `openai-codex` provider, then restores the external route at provider-info, model, stream-history-source, and error boundaries. This preserves pi-ai semantics for response IDs, reasoning signatures, tool-call IDs, and replay envelopes.

Each operation obtains an immutable profile from current settings. A concurrent settings update cannot alter an operation already in progress; the next operation receives the new configuration while the outer adapter instance remains stable.

The model catalog comes from the installed pi-ai version. Model selection, image budgets, cache policy, timeout, and bounded retry are resolved once at the profile boundary. Unknown or duplicate model selections fail before network I/O; an absent `models` value advertises the complete catalog, while an explicit empty array advertises none.

## CodexCredentialStore

The credential record key is `dsh-codex/openai-codex`. The adapter reads and modifies only that record and accepts OAuth grants only. API keys, records belonging to another provider, and structurally invalid data fail closed. Writes and deletion use the DSH credentials service's serialized interfaces: a deletion that acquires the lock first prevents refresh from starting, while a refresh already holding the lock completes before deletion becomes the final state. Credentials therefore cannot be resurrected after sign-out.

The Web settings page receives only sign-in methods, sanitized notices, an authorization-page URL, a verification code, and completion state. Access tokens, refresh tokens, complete grants, and complete provider errors do not cross the loopback RPC or enter command output.

## AuthorizationBridge

The Host starts, cancels, and observes sign-in through the DSH authorization service. It uses the credentials service to inspect configured-state metadata or sign out. The RPC bounds concurrent attempts, long-poll waiters, event counts, string lengths, and accepted URLs. After login returns, the plugin checks cancellation again while the credentials service holds the serialized write lock for this record. That mutate callback is the cancellation linearization point: cancellation before it selects the grant prevents the write; after selection the write completes, and the plugin does not issue a compensating delete that could erase a newer sign-in already queued by another DSH process. A generation tracker that contains no credential material holds the commit phase through the matching `authorization/settled` event. The settings page and `/codex-login cancel` reject a post-linearization cancel in the same synchronous call stack and keep observing the final `authorized` state. Sign-out bypasses that barrier, aborts active attempts, and then explicitly deletes the credential through the same serialized record path, so an older in-progress write cannot resurrect the credential after sign-out completes. A completed attempt ID retained briefly for status retrieval cannot cancel a newer sign-in.

`/codex-login status|cancel|logout` uses the same boundary and prevents command input from entering conversation history.

## SessionPreferences

`/codex` changes only the session that receives the command:

- `fast on|off` controls whether the priority service tier is requested and defaults to off;
- `transport` accepts `auto`, `sse`, `websocket`, or `websocket-cached` and defaults to `auto`;
- `reset` restores that session's defaults.

Preferences live in a capacity-bounded in-memory table that returns immutable snapshots; they do not change global provider settings. A failed Fast request is not replayed automatically on another service tier, avoiding duplicate tool side effects. Real account entitlement for this tier must be confirmed by release acceptance.

The raw DSH session ID is used only for preference lookup and message/replay provenance. The transport/cache session ID passed to pi-ai is namespaced with `dsh-codex:`. `/codex reset`, `agent/disposed`, and runtime disposal use pi-ai's public exact-session APIs to clear only this plugin's WebSocket connection, fallback, and debug state. They never invoke no-argument global cleanup and do not affect sessions owned by another in-process pi-ai consumer. The namespace enters only pi-ai stream options; it does not rewrite history messages or replay envelopes.

## ModelEnablement

This plugin's settings page uses `llm.discoverModels` to display requestable models from the current pi-ai catalog and stores its selection under the `dsh-codex` settings namespace. The runtime registers only a direct discovery handler for that namespace, not a general configurable-provider directory, avoiding interference with DSH's general model editor.

The settings page requires at least one selected model. Selecting all removes the `models` override only when entries have no custom fields, allowing the directory to follow pi-ai version updates. Partial selections, extra fields, and custom parameters retain explicit configuration. Catalog filtering affects discovery only; exact hidden models remain resolvable, so older sessions are not invalidated merely because a model is hidden.

## ImagePolicy

Optional settings resolve to one immutable policy with no optional numeric fields. The attachment contract receives only `{ maxPixels, maxBytes }`. Zero, negative, fractional, `NaN`, and unsafe integers fail at the configuration boundary.

Remote images extend the existing `read_image` tool through a `tools/execute` middleware. Local paths delegate unchanged. HTTP(S) URLs pass public-DNS validation, address pinning, per-hop redirect checks, one total timeout, a MIME allowlist, and byte limits both before and after decompression. Accepted content is committed to the DSH attachment store before the middleware returns the original tool's output schema.

Each plugin instance runs at most two remote-image jobs and queues at most 32; a full queue returns `TOO_MANY_REQUESTS`. Cancellation while queued removes the job, and cancellation during download aborts network work. Plugin disposal first closes the limiter, atomically rejects every queued job, and aborts active model-resolution or network work through a separate lifetime signal; Context cleanup waits for jobs that already entered `saveImage` to settle. The current public DSH `saveImage` interface has no `AbortSignal` or rollback contract, so cancellation after persistence begins guarantees only that success is not returned to the caller; it cannot guarantee deletion of an attachment that may already have been stored. The execution slot also remains occupied until `saveImage` settles. The bounded queue and lifecycle closure prevent new post-disposal work and unbounded memory growth.

## FailureNormalizer and QuotaObserver

`FailureNormalizer` converts a DSH `LlmFailure`, including embedded structured JSON, into a stable classification. Only verifiable structured `code`/`type` values such as `AccountQuotaExceeded` or `insufficient_quota`, or narrowly scoped account-level text confirming exhausted usage, become `QUOTA`; an ordinary 429 remains `RATE_LIMIT`. Multiple embedded JSON objects retain independent provenance: reset, request ID, and status may come only from the failure's top level or one `error` envelope that independently proves quota, never by combining envelopes. pi-ai `0.82.1` collapses distinct 429 responses into one ChatGPT usage-limit message and no longer exposes the original code/body. That evidence-free result becomes non-retryable `QUOTA_OR_RATE_LIMIT` instead of being mislabeled as confirmed account quota.

`QUOTA`, `QUOTA_OR_RATE_LIMIT`, and confirmed transport failures are rebuilt as minimal failures containing a fixed sanitized message, code, and optional valid HTTP status/safe-character request ID. Arbitrary provider fields and WebSocket close reasons are never reflected. `QUOTA_OR_RATE_LIMIT` is not written to `QuotaObserver`: it fails without retry when no partial output exists and only preserves already safe plain text when partial output exists.

`QuotaObserver` records only successful completion, `QUOTA`, and a reset timestamp accepted by strict format and bounded-horizon checks. Snapshots have three states: `unknown`, `recent-success`, and `exhausted`. It does not poll an account, display a balance or percentage, or call undocumented plan-quota endpoints.

## StreamResilience

This module runs on the `llm/stream` waterfall:

1. forward provider chunks while tracking open blocks;
2. apply narrow classification when a terminal error, directly thrown confirmed quota/usage-limit/transport, public `STREAM_CLOSED`/WebSocket failure, or EOF without a terminal chunk arrives;
3. if plain text exists and no tool call was emitted, close open blocks, append a recovery notice, and finish with `stop`;
4. if a tool call exists, including a tool-only stream with no text, return a non-retryable failure without replaying the complete request.

The module does not execute tools or add a hidden pre-stream retry loop. Only a pre-output `RATE_LIMIT`, `SERVER`, `TIMEOUT`, or confirmed `TRANSPORT` that matches the retry policy is eligible for at most two upper-layer retries. Directly thrown confirmed failures use the same sanitization and recovery path, while unrelated exceptions still propagate unchanged. Fast and transport selection never triggers service-tier downgrade or full-request replay.

## Profile composition

`codex-community.patch.yml` inserts authorization and `dsh-codex` without modifying the general `llm-pi-ai` Cordis row. Other pi-ai providers remain available in the same profile.

This plugin's external route is `dsh-codex`, and its credential key is `dsh-codex/openai-codex`; routes and credential scopes belonging to the general plugin remain unchanged. If a user enables both Codex routes, the model selector shows two provider groups. Every DSH upgrade must rerun bundle coexistence, replay, and isolated-profile-load tests.

## Other capability boundaries

- Session compaction uses DSH's built-in automatic compaction and `/compact`; this plugin does not rewrite the compaction protocol.
- Web search uses DSH tools and their corresponding credentials; it does not reuse ChatGPT OAuth.
- Image generation or editing requires a separate model, credentials, and billing boundary and is not provided by `0.0.1`.
