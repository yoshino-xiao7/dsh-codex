# Configuration reference

[简体中文](configuration.md) | [English](configuration.en.md)

The production configuration for the `dsh-codex` bundle lives under `dsh-codex.config` in `codex-community.patch.yml`. A normal installation already supplies safe defaults. The settings page saves `models` only when needed, so the default bundle omits that key.

## Bundle defaults

```yaml
defaultFast: false
defaultTransport: auto
defaultTextVerbosity: low
defaultReasoningSummary: auto
partialResponseRecovery: true
cacheRetention: short
streamIdleTimeoutMs: 300000
maxRequestImageBytes: 20971520
requestImagePixelBudget: 4194304
requestImageMaxBytes: 1048576
```

Omitting `models` makes the model selector show every Codex model in the currently installed catalog.

## Top-level fields

| Key | Type and allowed values | Default | Unit and behavior |
| --- | --- | --- | --- |
| `defaultFast` | Boolean | `false` | No unit. When the selected model supports Fast, selects whether requests without an explicit conversation override use the priority service tier. |
| `defaultTransport` | `auto`, `sse`, `websocket`, or `websocket-cached` | `auto` | No unit. Default for conversations without an explicit transport override. A change moves those conversations' next request to a new transport generation, without inheriting the old connection, cache, or fallback latch. An in-flight request drains on its old generation before cleanup; conversations with an explicit transport override do not roll over for this global change. |
| `defaultTextVerbosity` | `low`, `medium`, or `high` | `low` | No unit. Reply verbosity used when no explicit conversation override exists. |
| `defaultReasoningSummary` | `auto`, `concise`, `detailed`, or `off` | `auto` | No unit. Reasoning-summary form used when no explicit conversation override exists; `off` requests no summary. |
| `partialResponseRecovery` | Boolean | `true` | No unit. When enabled, a stream that fails after safe plain text can close the text and preserve the partial response. When disabled, the error remains an error instead of converting the partial response to success. A stream with an incomplete tool call always fails closed. |
| `models` | Array of model entries, or omitted | Omitted | No unit. Omission exposes the complete catalog; an empty array hides every Codex model from the selector; a non-empty array exposes only the listed models. Saved sessions can still resolve a catalog model by its exact model ID. |
| `cacheRetention` | `none`, `short`, or `long` | `short` | No unit. Passed through as the context-cache retention policy for Codex requests. The plugin does not convert these enum values into fixed durations. |
| `streamIdleTimeoutMs` | Number from `1` through `2147483647`, inclusive | `300000` | Milliseconds. Limits only idle time waiting for the next provider stream item, not consumer processing time. Fractions inside the range are accepted. Expiry produces `TIMEOUT`. |
| `maxRequestImageBytes` | Positive safe integer from `1` through `9007199254740991`, inclusive | `20971520` | Bytes. Bounds the accumulated base64 image payload for one request; text, tools, image descriptors, and JSON structure are excluded. Over-budget images are replaced with fixed text, oldest first. |
| `requestImagePixelBudget` | Positive safe integer from `1` through `9007199254740991`, inclusive | `4194304` | Pixels. Total-pixel budget for each request image, mapped to attachment request `maxPixels`. The default equals `2048 × 2048`. |
| `requestImageMaxBytes` | Positive safe integer from `1` through `9007199254740991`, inclusive | `1048576` | Raw bytes. Byte budget for each generated request-image version, mapped to attachment request `maxBytes`. The default is `1 MiB`. |

## Model entries

Each `models` entry supports these fields:

| Key | Required | Type and range | Behavior |
| --- | --- | --- | --- |
| `id` | Yes | String | Must name a Codex model in the currently installed catalog. Unknown or duplicate IDs are rejected during configuration validation. |
| `name` | No | String | Overrides the model display name. Omission uses the catalog name. |
| `contextWindow` | No | Positive safe integer from `1` through `9007199254740991`, inclusive | Overrides the model context window. |
| `maxTokens` | No | Positive safe integer from `1` through `9007199254740991`, inclusive | Overrides the model output cap and becomes the request default when no output cap is specified explicitly. |

Example:

```yaml
models:
  - id: gpt-5.4
    name: Codex
    contextWindow: 272000
    maxTokens: 128000
```

Model IDs and capabilities follow the pinned runtime catalog. Check the catalog discovered by the settings page before editing; do not infer that an example ID is always available.

## Model capabilities and reasoning levels

The settings page gets model names, context windows, and maximum outputs from the currently installed provider catalog; it is not a dynamic account model directory. Harness's generic `llm.discoverModels` provides the base catalog fields, while this plugin's independent loopback-only read-only capability RPC supplies input modalities, selectable reasoning efforts, and Fast support. If that RPC is unavailable, the base catalog remains visible and unproven capability badges are omitted. Low through Max in the conversation model selector follows the actual semantics of the currently installed provider catalog instead of being inferred from pi-ai's generic effort vocabulary:

| Model | Selectable reasoning efforts |
| --- | --- |
| GPT-5.3 Codex Spark | Low, Medium, High, Xhigh |
| GPT-5.4, GPT-5.4 mini, GPT-5.5 | Low, Medium, High, Xhigh |
| GPT-5.6 Luna | Low, Medium, High, Xhigh, Max |
| GPT-5.6 Sol | Low, Medium, High, Xhigh, Max |
| GPT-5.6 Terra | Low, Medium, High, Xhigh, Max |

The selector no longer shows generic `Default`, `Off`, or `Minimal` entries that are not selectable efforts in the current catalog. `Ultra` in the Codex product catalog also enables proactive task delegation; it is not a plain reasoning effort that a model Provider can implement by sending one wire value. This plugin does not yet own Harness Agent orchestration, so it does not disguise `Ultra` as `Max` or another wire value. The plugin neither invents nor labels a default effort that the catalog does not provide. When a request has no explicit effort, the current Provider or service applies its default behavior. A future model without catalog-provided capability semantics remains usable through that behavior but receives no inferred effort controls.

Model cards show text/image input, the selectable reasoning range, and Fast only when supplied by the safe capability projection. An unknown model never receives reasoning or Fast badges merely because its name resembles a known model. If an older conversation still stores `Off` or `Minimal`, a **Repair old reasoning level** action appears beside the composer. Merely opening the conversation never rewrites the selection. Clicking the action removes the unsupported explicit effort, after which the current Provider or service applies its default behavior. Repair neither displays, writes, nor claims a concrete default effort that the catalog does not provide. It still uses the Harness model selector's model-persistence semantics, so the current model becomes the default model for future conversations.

## Global defaults and conversation overrides

`1.1.0` reads the four global-default fields above from the `dsh-codex` settings namespace. Changing one field in settings writes back only that field; it does not replace model selection or other values in the namespace. DSH persists these defaults, so they survive a restart.

The in-memory conversation table retains only fields the user explicitly changes and merges them with the current global defaults when resolving a request. A conversation that explicitly selected Fast therefore keeps that choice, while its untouched Transport, reply-verbosity, and reasoning-summary fields follow later global-default changes. `/codex reset` removes the current conversation's explicit overrides instead of writing four factory constants. Restarting the process discards conversation overrides but retains the persistent global defaults.

## Per-session request preferences

The lightning button to the left of the conversation model selector and `/codex set fast on|off` update the same current-session Fast preference. On GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra, enabling it uses the official Fast priority service tier starting with the next request; disabling it restores standard speed starting with the next request. Fast targets 1.5× speed and consumes more usage. GPT-5.3 Codex Spark and GPT-5.4 mini never receive the Fast service tier.

The adjacent Transport button and `/codex set transport auto|sse|websocket|websocket-cached` share the current-conversation transport preference. The graphical menu displays the actual current value and can reset to Auto. `auto` lets the Provider select a transport; the other three choices request their named transport explicitly.

Every explicit transport selection moves only the current exact conversation to a new transport generation. The next request no longer inherits the old WebSocket connection, debug counters, or WebSocket-to-SSE fallback latch, and other conversations are unaffected. A request already running on the retired generation is not closed and cleanup waits for it to finish. If `auto` is already selected while health reports an active SSE fallback, **Reset to Auto** remains enabled so that the next request can establish clean transport state.

The same menu provides two truthful request preferences:

- reply verbosity: `/codex set verbosity low|medium|high`, default `low`;
- reasoning summary: `/codex set summary auto|concise|detailed|off`, default `auto`.

Both values are passed directly to the Provider request layer and do not rewrite model reasoning effort. `verbosity` controls final-answer detail, while `summary` selects the reasoning-summary form and `off` requests no summary. Like Fast and Transport, each change applies to the next request.

Current-conversation overrides for these four controls exist only in process memory; fields without an override use the persistent global defaults. An in-flight request is not changed by a toggle, and a failed Fast request is not replayed automatically on a lower tier. Transport health at the bottom of the menu is sanitized, process-local state for this conversation—requests, connection reuse, delta context, and SSE fallbacks—not an account-side service status. It contains neither response IDs nor raw WebSocket errors.

## Validation and activation

- An omitted or `null` Boolean, enum, timeout, or image limit receives its default. `models: null` does not select the default catalog; omit `models` instead.
- Type mismatches, unknown enum values, ordinary numbers outside the allowed ranges, fractional image limits, and unknown or duplicate model IDs are rejected during plugin load or settings save. A rejected update does not replace the last valid configuration.
- Use only the finite JSON/YAML numbers listed above. `NaN`, infinity, and undocumented fields are outside the supported configuration interface.
- A configuration update takes effect on the next adapter operation. An operation already in progress continues with the immutable configuration snapshot it captured at start.
- Global defaults are bundle configuration keys. The model selector, adjacent conversation-request menu, and `/codex` change process-local overrides for the current conversation.
