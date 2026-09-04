# Architecture

[简体中文](architecture.md) | [English](architecture.en.md)

## Responsibilities

This plugin registers the Codex route, settings namespace, OAuth flow, session preferences, and reliability policy. Message conversion, model protocols, tool permissions, session persistence, and OAuth protocol behavior use public interfaces from DSH, `@deepseek-ai/dsh-llm-pi-ai`, and pi-ai.

```text
DSH Web settings ── loopback RPC ── AuthorizationBridge
        │                                  │
        ├── on-demand checks ───── ConnectionDiagnostics
        │                                  └── one-shot grant ── CodexNetworkProbe
        │                                  │
        │ entry / visible / reset          │
        ▼                                  ▼
AccountUsageReader ─────────────── CodexCredentialStore
        │                                  │
        ▼                                  ▼
Codex Web usage endpoint           ChatGPT OAuth grant

Harness Agent Loop
        │
        ├── SessionPreferences ── Fast, Transport, reply, summary
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

`/codex-login status|cancel|logout` uses the same boundary and prevents command input from entering conversation history. The authorization URL and verification code reach settings only as bounded fields. Copying requires an explicit user click; the Host never receives clipboard content and neither logs nor persists short-lived authorization material.

## AccountUsageReader

When settings mounts, becomes visible again, reaches a usage-window reset boundary, or the user clicks Refresh or runs `/codex-usage refresh`, the Host-side `AccountUsageReader` uses the current OAuth grant to request the Web-backend usage compatibility endpoint used by the official Codex client. The page uses one-shot timers aligned to the nearest transition rather than background polling. Weekly relative days decrement locally at the `ceil(remaining time / 24 hours)` display boundaries, and crossing into the under-24-hour exact-time display also rerenders locally; neither transition causes an extra network read. The reader strictly parses used percentages, window durations, reset times, and the optional plan type, then converts the five-hour and weekly windows into a minimal credential-free snapshot. Access tokens, refresh tokens, account IDs, raw responses, and arbitrary response headers never cross the loopback RPC.

Low-usage and reset reminders are a pure client projection of this sanitized snapshot. They consider only `limitId=codex` windows of 300 and 10080 minutes, warn at 20% remaining or below, and show exhaustion at 0% remaining. Reaching a verified reset boundary triggers exactly one refresh to confirm server state. Failure retains the previous safe reading and waits for a manual refresh instead of retrying in a loop. Reminders exist only in the plugin surface while the app is running; they start neither a background job nor an operating-system notification permission flow.

This endpoint is treated as a Web-backend compatibility boundary, not as a stable plugin public API. Requests have timeout, response-size, and numeric-range limits. A network failure, authentication failure, or schema change is never rendered as zero remaining usage and does not erase the latest verified reading. When no live reading can be retained, the page safely falls back to recent-request `QuotaObserver` state or “unknown” instead of inferring usage. `/codex-usage status` reads only that process-local request observation; only `refresh` calls `AccountUsageReader` for real account windows.

## ConnectionDiagnostics

Connection diagnostics use a dedicated `/dsh-codex-diagnostics` loopback RPC instead of expanding the authorization RPC. Settings keeps the surface collapsed and never runs it automatically. `local` reads only process-local route state, the model catalog, enabled counts, and local credential metadata; it performs no network access or OAuth refresh. `account` performs the same local checks and calls the existing `AccountUsageReader` exactly once. That reader may refresh OAuth under its normal contract, but it never sends a model request or consumes model usage.

`network` is a separately isolated active mode. The first step reads only the local runtime model snapshot, binds the first enabled model under the existing ordering policy, validates its ID against a character allowlist and a 256-character bound, and creates a short-lived single-use consent grant. The confirmation displays that model ID and the usage warning. Only the second step carrying that grant lets `CodexNetworkProbe` use the same model, bypass AgentLoop and `StreamResilience`, and call `CodexRouteAdapter` directly with one fixed short prompt. Local-state and credential preflight share a 30-second deadline before the probe; an internal deadline reports the fixed `preflight-timeout` code instead of impersonating user cancellation, and no model request starts before preflight passes. The probe forces SSE, disables Fast, carries no current-conversation history, current-conversation system prompt, or tools, and passes through no recovery or automatic retry. Its request stays on the public Codex SDK wire schema and does not force `max_output_tokens` onto the dedicated endpoint. That endpoint exposes no usable server-side hard output limit. The probe calls iterator teardown immediately after the first non-empty model text to minimize usage, but cancellation or teardown cannot guarantee that the service has not charged usage. Automation exercises the real Provider→PiAiAdapter→Route→Probe chain against a mock HTTP boundary for 200, `response.incomplete`, and 400; it is not live-account acceptance. The Provider may still add its fixed default instruction under its public contract. Because the probe actually contacts a model, it consumes account usage. Expiry or prior consumption cannot replay the grant; cancellation after dispatch cannot guarantee that the request was unsent or consumed no usage, so history retains a fixed sanitized result with `attempted=true` and the validated model ID.

A process-wide coordinator preserves quarantine across runtime replacement. After request timeout, cancellation, or plugin disposal, another real diagnostic is allowed only when the old `next()` has settled, an explicit `return()` has successfully yielded `{ done: true }`, and both temporary safe preferences and transport resources have been cleaned successfully. A missing or incomplete `return()`, teardown or cleanup failure, or an iterator that never settles leaves diagnostics busy; a page hot reload cannot bypass it. A complete application-process restart is then required, preventing overlap between potentially live billable requests.

The browser report is fixed to a version, mode, overall outcome, observation time, and check array. A check contains only fixed IDs, fixed status codes, bounded boolean/numeric/enumerated facts, and the allowlist- and length-validated actual model ID for a real diagnostic. Tokens, complete grants, account IDs, raw responses, headers, arbitrary exception messages, request IDs, prompts, and model output never cross the boundary. Both account-read and real-request failures map to fixed sanitized categories; `INVALID_REQUEST`, `PI_AI_ERROR`, `UNKNOWN_MODEL`, and `MISSING_CREDENTIAL` each receive a fixed code rather than exposing raw status text or response bodies.

Every completed or cancelled report enters a process-local ring history capped at 20 entries. It is not written to plugin configuration or disk and disappears at restart. The Web client loads history only after an explicit user action and validates the fixed schema again before copying or exporting JSON; clearing history is also explicit.

## SessionPreferences

The lightning button to the left of the model selector, the adjacent conversation-request menu, and `/codex` update the same current-session state:

- the lightning button or `fast on|off` controls whether the Fast priority service tier is requested;
- `transport` accepts `auto`, `sse`, `websocket`, or `websocket-cached`;
- `verbosity` accepts `low`, `medium`, or `high` and maps truthfully to the reply-verbosity request field;
- `summary` accepts `auto`, `concise`, `detailed`, or `off` and maps truthfully to the reasoning-summary request field;
- `reset` removes the current conversation's overrides and restores the current global defaults.

Global defaults live in the `dsh-codex` settings namespace. The capacity-bounded in-memory table stores only fields explicitly overridden by each conversation, merges them with the current defaults at resolve time, and returns immutable snapshots. Changing a global default therefore preserves an explicitly selected field while untouched fields follow immediately. A global Transport change rolls over only conversations currently inheriting that default: the next request receives a new transport generation and cannot inherit the old connection, cache, or fallback latch, while conversations with an explicit Transport override keep their generation. An in-flight request leases its old generation until both the stream terminal state and iterator teardown have settled, so a settings update does not close it. Restart clears conversation overrides but retains persistent defaults. Fast applies only to GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra, using the official priority service tier to target 1.5× speed while consuming more usage. Other models never carry that tier. Every change affects the next request, not one already in flight. A failed Fast request is not replayed automatically on another service tier, avoiding duplicate tool side effects.

The raw DSH session ID is used only for preference lookup and message/replay provenance. The transport/cache session ID passed to pi-ai is namespaced with `dsh-codex:` and places a manager-unique epoch plus the generation before the logical session ID, so hot-replacement managers and different generations remain distinct even if pi-ai truncates a prompt-cache key. The Host reads public exact-session debug statistics only for the current generation and projects only request, connection creation/reuse, delta-context, WebSocket-failure, and SSE-fallback counts. Response IDs, raw WebSocket errors, and input content never cross RPC. `/codex reset` and explicit conversation Transport changes roll over that exact conversation; `agent/disposed` and runtime disposal stop owning the affected generations. Each path lets active leases drain before cleanup, clears only exact IDs recorded as owned by that manager, treats disposal of an unknown logical session as a no-op, never invokes no-argument global cleanup, and does not affect another in-process pi-ai consumer. The resource table is capacity-bounded: idle conversations may be reclaimed, while a generation with an active lease cannot be evicted.

## ModelEnablement

This plugin's settings page uses `llm.discoverModels` for model ID, name, context, and maximum output—the fields carried by Harness's generic discovery schema—and stores its selection under the `dsh-codex` settings namespace. Input modalities, selectable reasoning efforts actually exposed by the current catalog, and Fast support come through the independent loopback-only read-only RPC `/dsh-codex-model-capabilities`. Its `get` endpoint accepts only an empty object; if it is unavailable, settings keeps the generic catalog fields and omits capability badges it cannot prove. The runtime does not register a general configurable-provider directory, avoiding interference with DSH's general model editor.

The settings page requires at least one selected model. Selecting all removes the `models` override only when entries have no custom fields, allowing the directory to follow pi-ai version updates. Partial selections, extra fields, and custom parameters retain explicit configuration. Catalog filtering affects discovery only; exact hidden models remain resolvable, so older sessions are not invalidated merely because a model is hidden.

Model names, context windows, and input capabilities come from the installed provider catalog and are not presented as a dynamic account directory. `CodexRouteAdapter` projects reasoning controls from the actual semantics of the currently installed provider catalog: it removes generic `Default`, `Off`, and `Minimal` entries that are not current selectable efforts and exposes only Low through Max, which the Provider request layer can represent truthfully. The plugin does not invent, label, or write a per-model default that the catalog does not provide; without an explicit effort, the request layer leaves default behavior to the current Provider or service. Codex `Ultra` combines the highest plain reasoning level with proactive task delegation and is therefore an Agent orchestration mode. This plugin neither sends a fabricated `ultra` wire value nor silently degrades it to `Max`. Unknown models receive no inferred controls, and the route boundary rejects direct injection of an effort not supplied by the catalog.

`codexModelCapabilityDescriptor` is the single Host projection for catalog fields and controls the Provider can actually express. It allowlists only model ID, name, context, maximum output, input modalities, reasoning levels, and Fast support, then returns an immutable snapshot. The Provider, route adapter, settings capability badges, and per-conversation Fast query reuse the same source; the Web client no longer keeps a model-ID-based Fast table. Unknown models remain usable through the catalog but receive no inferred input, reasoning, or Fast capability.

## ImagePolicy

Optional settings resolve to one immutable policy with no optional numeric fields. The attachment contract receives only `{ maxPixels, maxBytes }`. Zero, negative, fractional, `NaN`, and unsafe integers fail at the configuration boundary.

Remote images extend the existing `read_image` tool through a `tools/execute` middleware. Local paths delegate unchanged. HTTP(S) URLs pass public-DNS validation, address pinning, per-hop redirect checks, one total timeout, a MIME allowlist, and byte limits both before and after decompression. Accepted content is committed to the DSH attachment store before the middleware returns the original tool's output schema.

Each plugin instance runs at most two remote-image jobs and queues at most 32; a full queue returns `TOO_MANY_REQUESTS`. Cancellation while queued removes the job, and cancellation during download aborts network work. Plugin disposal first closes the limiter, atomically rejects every queued job, and aborts active model-resolution or network work through a separate lifetime signal; Context cleanup waits for jobs that already entered `saveImage` to settle. The current public DSH `saveImage` interface has no `AbortSignal` or rollback contract, so cancellation after persistence begins guarantees only that success is not returned to the caller; it cannot guarantee deletion of an attachment that may already have been stored. The execution slot also remains occupied until `saveImage` settles. The bounded queue and lifecycle closure prevent new post-disposal work and unbounded memory growth.

## FailureNormalizer and QuotaObserver

`FailureNormalizer` converts a DSH `LlmFailure`, including embedded structured JSON, into a stable classification. Only verifiable structured `code`/`type` values such as `AccountQuotaExceeded` or `insufficient_quota`, or narrowly scoped account-level text confirming exhausted usage, become `QUOTA`; an ordinary 429 remains `RATE_LIMIT`. Multiple embedded JSON objects retain independent provenance: reset, request ID, and status may come only from the failure's top level or one `error` envelope that independently proves quota, never by combining envelopes. pi-ai `0.84.4` collapses distinct 429 responses into one ChatGPT usage-limit message and no longer exposes the original code/body. That evidence-free result becomes non-retryable `QUOTA_OR_RATE_LIMIT` instead of being mislabeled as confirmed account quota.

`QUOTA`, `QUOTA_OR_RATE_LIMIT`, confirmed transport failures, and Codex server overloads are rebuilt as minimal failures containing a fixed sanitized message, code, and optional valid HTTP status/safe-character request ID. Arbitrary provider fields, raw overload text, and WebSocket close reasons are never reflected. When pi-ai loses the structured `server_error`, only a complete match of the fixed Codex overload message becomes `SERVER`; nearby generic busy prose remains unknown. `QUOTA_OR_RATE_LIMIT` is not written to `QuotaObserver`: it fails without retry when no partial output exists and only preserves already safe plain text when partial output exists.

`QuotaObserver` records only successful completion, `QUOTA`, and a reset timestamp accepted by strict format and bounded-horizon checks. Snapshots have three states: `unknown`, `recent-success`, and `exhausted`. It neither polls an account nor displays a balance or percentage. Instead, it is the request-observation fallback when `AccountUsageReader` has no usable live snapshot; the two evidence types never masquerade as each other.

## StreamResilience

This module runs on the `llm/stream` waterfall:

1. forward provider chunks while tracking open blocks;
2. apply narrow classification when a terminal error, directly thrown confirmed quota/usage-limit/transport/server overload, public `STREAM_CLOSED`/WebSocket failure, or EOF without a terminal chunk arrives;
3. if plain text exists and no tool call was emitted, close open blocks, append a recovery notice, and finish with `stop`;
4. if a tool call exists, including a tool-only stream with no text, return a non-retryable failure without replaying the complete request and tell the user to verify tool execution state before continuing manually.

The module does not execute tools or add a hidden pre-stream retry loop. Only a pre-output `RATE_LIMIT`, `SERVER`, `TIMEOUT`, or confirmed `TRANSPORT` that matches the retry policy is eligible for at most two upper-layer retries. Directly thrown confirmed failures use the same sanitization and recovery path, while unrelated exceptions still propagate unchanged. Fast and transport selection never triggers service-tier downgrade or full-request replay.

## Profile composition

`codex-community.patch.yml` inserts authorization and `dsh-codex` without modifying the general `llm-pi-ai` Cordis row. Other pi-ai providers remain available in the same profile.

This plugin's external route is `dsh-codex`, and its credential key is `dsh-codex/openai-codex`; routes and credential scopes belonging to the general plugin remain unchanged. If a user enables both Codex routes, the model selector shows two provider groups. Every DSH upgrade must rerun bundle coexistence, replay, and isolated-profile-load tests.

## Other capability boundaries

- Session compaction uses DSH's built-in automatic compaction and `/compact`; this plugin does not rewrite the compaction protocol.
- Web search uses DSH tools and their corresponding credentials; it does not reuse ChatGPT OAuth.
- Image generation or editing requires a separate model, credentials, and billing boundary and is not currently provided by this plugin.
