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

## Validation and activation

- An omitted or `null` Boolean, enum, timeout, or image limit receives its default. `models: null` does not select the default catalog; omit `models` instead.
- Type mismatches, unknown enum values, ordinary numbers outside the allowed ranges, fractional image limits, and unknown or duplicate model IDs are rejected during plugin load or settings save. A rejected update does not replace the last valid configuration.
- Use only the finite JSON/YAML numbers listed above. `NaN`, infinity, and undocumented fields are outside the supported configuration interface.
- A configuration update takes effect on the next adapter operation. An operation already in progress continues with the immutable configuration snapshot it captured at start.
- `/codex` Fast and transport preferences are temporary state for the current session in the current process, not bundle configuration keys.
