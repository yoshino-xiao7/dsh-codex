# dsh-codex

[简体中文](README.md) | [English](README.en.md)

A Codex plugin for DeepSeek Harness with ChatGPT OAuth sign-in, Codex models, image input, and reliable streaming responses.

> Current version: `1.0.0` stable release (in release preparation and not yet published). npm package: `dsh-codex-community`; the currently published version remains `0.0.4`.

## Features

- Sign in, sign in again, or sign out of ChatGPT OAuth from DSH Web;
- select and enable Codex models with streaming text, reasoning, usage, tool calls, and session replay;
- use DSH Web's native image paste, drag-and-drop, and attachment flow;
- let `read_image` safely read HTTP(S) images with address, redirect, format, size, and timeout limits;
- provide valid pixel and byte budgets for request images, preventing invalid `maxPixels` values;
- classify `AccountQuotaExceeded` as non-retryable account quota and show a sanitized reset time;
- preserve safe partial text after a stream failure, while incomplete tool calls stop without replaying the request;
- actively refresh real five-hour and weekly limits when settings opens, the page becomes visible again, or a usage-window reset boundary is reached, with immediate refresh through the button or `/codex-usage refresh`; the weekly under-24-hour threshold changes local time display only;
- present one consistent remaining-usage meaning in compact cards, including the safe plan type and reset time; five-hour limits always use exact time and weekly limits do so inside 24 hours;
- list selected models first in settings and collapse unselected models by default, with compact `K` labels taken from the current provider catalog for context and maximum output;
- use the lightning button to the left of the model selector for official Fast (1.5×), and use the adjacent graphical button or `/codex` to select Auto, SSE, WebSocket, or cached WebSocket transport for the current conversation;
- read input modalities, selectable reasoning efforts actually exposed by the installed provider catalog, and Fast support through an independent local loopback-only read-only Host RPC, merge them with Harness's generic catalog, and omit badges for unavailable or unknown capabilities instead of inferring them;
- choose current-session reply verbosity (low, medium, or high) and reasoning-summary style (auto, concise, detailed, or off), effective on the next request;
- copy the OAuth sign-in link and verification code separately; copying occurs only after an explicit user click and does not log short-lived credentials;
- run an on-demand local or account check from collapsed connection diagnostics and copy a sanitized report containing only fixed statuses and bounded facts;
- inspect sanitized per-conversation transport health, including request count, connection reuse, delta context, and SSE fallbacks.

## Requirements

- DeepSeek Harness `0.1.1-rc.2`
- Node.js `>=22.19.0 <25`

## Installation

`1.0.0` is not published yet. After development and release gates complete, install the exact version:

```sh
dsh plugin --profile web add dsh-codex-community@1.0.0
dsh web
```

## Sign in and use

1. Open **Settings → OpenAI Codex** and complete the ChatGPT OAuth prompts.
2. Enable models on the same page.
3. Choose a Codex model from the conversation model selector; use the lightning button to its left for Fast, and use the adjacent transport button or `/codex set transport ...` for the current conversation's transport.

Available commands:

```text
/codex-login status
/codex-login cancel
/codex-login logout
/codex-usage status
/codex-usage refresh
/codex status
/codex reset
/codex set fast on|off
/codex set transport auto|sse|websocket|websocket-cached
/codex set verbosity low|medium|high
/codex set summary auto|concise|detailed|off
```

Fast, transport, reply verbosity, and reasoning-summary preferences live only in the current session and process. Restart restores off, Auto, low verbosity, and automatic summary respectively. Every change applies to the next request. For GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra, Fast uses the official priority service tier, targets 1.5× speed, and consumes more usage. A failed request is not replayed automatically on a lower tier.

Update:

```sh
dsh plugin --profile web update dsh-codex-community@1.0.0
dsh web
```

Before removal, sign out under **Settings → OpenAI Codex**, then run:

```sh
dsh plugin --profile web remove dsh-codex-community
dsh web
```

## Error handling

- `Image request maxPixels must be a positive integer.`: omitted or `null` image budgets receive safe defaults; zero, negative, fractional, and other explicitly invalid values are rejected while loading configuration.
- `AccountQuotaExceeded`: the plugin stops automatic retries and preserves safe visible text. A reset time is shown only when present and validated. It does not try to bypass account quota by changing transport.
- `QUOTA_OR_RATE_LIMIT`: when only generic 429 text remains and structured evidence is unavailable, the plugin neither reports confirmed account quota nor retries automatically. Retry manually later or check the account surface.
- A response stops halfway: plain text can be preserved safely; an incomplete tool call is not replayed, avoiding duplicate side effects.

See [Troubleshooting](docs/troubleshooting.en.md) for diagnostic steps.

## Support boundaries

- `1.0.0` remains in development and is not published. Its Linux, macOS, and Windows CI/profile smoke plus live-account acceptance are all pending in the [acceptance draft](docs/releases/v1.0.0.acceptance.json).
- Historical `0.0.4` release evidence remains available but is not inherited as `1.0.0` acceptance.
- The settings page reads usage through the Web-backend compatibility endpoint used by the official Codex client. If that endpoint is unavailable or malformed, the page retains the latest safe reading and falls back to request observation or an unknown state instead of presenting the error as zero remaining usage.
- Model names, context windows, maximum outputs, and selectable Low-through-Max reasoning efforts follow the actual semantics of the installed provider catalog. The plugin neither invents nor labels a default effort that the catalog does not provide; when no effort is explicit, the current Provider or service applies its default behavior. Generic `Default`, `Off`, and `Minimal` entries are hidden, and agent-level `Ultra` is not disguised as a plain reasoning effort.
- Fast is limited to GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra and consumes more usage. Other models never receive the Fast service tier.
- Connection diagnostics do not perform an active model request. The local check is offline and the account check uses only the existing usage-reader boundary, so neither replaces live conversation, image, tool, or per-transport acceptance.
- Image generation and editing are not provided.
- See [Compatibility](docs/compatibility.en.md) for Windows, Linux, real OAuth, and real Codex network acceptance status.

## Documentation and contribution

- [Documentation index](docs/README.en.md)
- [Configuration reference](docs/configuration.en.md)
- [Contributing](CONTRIBUTING.en.md)
- [Security reports](SECURITY.md)
- [Support scope](SUPPORT.md)

Never attach a token, OAuth code, cookie, credential file, or complete private conversation to an issue.

Apache-2.0; see [LICENSE](LICENSE). This project is community-maintained and is not affiliated with or endorsed by OpenAI or DeepSeek.
