# Configuration reference

[简体中文](configuration.md) | [English](configuration.en.md)

The production configuration for the `dsh-codex` bundle lives under `dsh-codex.config` in `codex-community.patch.yml`. A normal installation already supplies safe defaults. The settings page saves `models` only when needed, so the default bundle omits that key.

## Bundle defaults

```yaml
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

The settings page gets model names, context windows, and maximum outputs from the currently installed provider catalog; it is not a dynamic account model directory. The conversation model selector uses model-specific reasoning levels and defaults verified against the first-party Codex model catalog instead of inferring them from pi-ai's generic effort vocabulary:

| Model | Selectable reasoning efforts | Default |
| --- | --- | --- |
| GPT-5.3 Codex Spark | Low, Medium, High, Xhigh | High |
| GPT-5.4, GPT-5.4 mini, GPT-5.5 | Low, Medium, High, Xhigh | Medium |
| GPT-5.6 Luna | Low, Medium, High, Xhigh, Max | Medium |
| GPT-5.6 Sol | Low, Medium, High, Xhigh, Max | Low |
| GPT-5.6 Terra | Low, Medium, High, Xhigh, Max | Medium |

The selector no longer shows generic `Default`, `Off`, or `Minimal` entries that are not subscription-Codex catalog efforts. `Ultra` in the Codex product catalog also enables proactive task delegation; it is not a plain reasoning effort that a model Provider can implement by sending one wire value. This plugin does not yet own Harness Agent orchestration, so it does not disguise `Ultra` as `Max` or another wire value. A future unverified model remains usable with its server default but receives no inferred effort controls.

If an older conversation still stores `Off` or `Minimal`, a **Repair old reasoning level** action appears beside the composer. Merely opening the conversation never rewrites the selection. Clicking the action switches to that model's current default. It uses the same persistence semantics as the Harness model selector, so the model also becomes the default for future conversations.

## Per-session Fast and Transport preferences

The lightning button to the left of the conversation model selector and `/codex set fast on|off` update the same current-session Fast preference. On GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra, enabling it uses the official Fast priority service tier starting with the next request; disabling it restores standard speed starting with the next request. Fast targets 1.5× speed and consumes more usage. GPT-5.3 Codex Spark and GPT-5.4 mini never receive the Fast service tier.

The adjacent Transport button and `/codex set transport auto|sse|websocket|websocket-cached` share the current-conversation transport preference. The graphical menu displays the actual current value and can reset to Auto. `auto` lets the Provider select a transport; the other three choices request their named transport explicitly.

Fast state belongs only to the current session in the current process and returns to off after a process restart. Transport preferences are likewise not persisted. An in-flight request is not changed by a toggle, and a failed Fast request is not automatically replayed on a lower tier.

## Validation and activation

- An omitted or `null` Boolean, enum, timeout, or image limit receives its default. `models: null` does not select the default catalog; omit `models` instead.
- Type mismatches, unknown enum values, ordinary numbers outside the allowed ranges, fractional image limits, and unknown or duplicate model IDs are rejected during plugin load or settings save. A rejected update does not replace the last valid configuration.
- Use only the finite JSON/YAML numbers listed above. `NaN`, infinity, and undocumented fields are outside the supported configuration interface.
- A configuration update takes effect on the next adapter operation. An operation already in progress continues with the immutable configuration snapshot it captured at start.
- Fast and transport preferences are temporary state for the current session in the current process, not bundle configuration keys. `/codex` can change them, and the lightning button plus adjacent Transport menu provide the same controls graphically.
