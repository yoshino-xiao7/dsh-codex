# dsh-codex

[简体中文](README.md) | [English](README.en.md)

A Codex plugin for DeepSeek Harness with ChatGPT OAuth sign-in, Codex models, image input, and reliable streaming responses.

> Current version: `0.0.2` technical preview, published under npm `latest` with a full GitHub Release. npm package: `dsh-codex-community`.

## Features

- Sign in, sign in again, or sign out of ChatGPT OAuth from DSH Web;
- select and enable Codex models with streaming text, reasoning, usage, tool calls, and session replay;
- use DSH Web's native image paste, drag-and-drop, and attachment flow;
- let `read_image` safely read HTTP(S) images with address, redirect, format, size, and timeout limits;
- provide valid pixel and byte budgets for request images, preventing invalid `maxPixels` values;
- classify `AccountQuotaExceeded` as non-retryable account quota and show a sanitized reset time;
- preserve safe partial text after a stream failure, while incomplete tool calls stop without replaying the request;
- read the real five-hour and weekly usage limits whenever the settings page opens or is refreshed manually, with a safe fallback and no OAuth credentials exposed to the Web page;
- use the lightning button to the left of the model selector or `/codex` to choose official Fast (1.5×) and transport for the current session, with Fast off and transport automatic by default.

## Requirements

- DeepSeek Harness `0.1.1-rc.2`
- Node.js `>=22.19.0 <25`

## Installation

Install an exact version:

```sh
dsh plugin --profile web add dsh-codex-community@0.0.2
dsh web
```

## Sign in and use

1. Open **Settings → OpenAI Codex** and complete the ChatGPT OAuth prompts.
2. Enable models on the same page.
3. Choose a Codex model from the conversation model selector; click the lightning button to its left when Fast is needed.

Available commands:

```text
/codex-login status
/codex-login cancel
/codex-login logout
/codex-usage
/codex status
/codex reset
/codex set fast on|off
/codex set transport auto|sse|websocket|websocket-cached
```

Fast and transport preferences are kept only for the current session in the current process; they are not persisted and return to their defaults after a process restart. For GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra, Fast uses the official priority service tier starting with the next request, targets 1.5× speed, and consumes more usage. Turning it off restores standard speed on the next request. A failed request is not automatically replayed on a lower tier.

Update:

```sh
dsh plugin --profile web update dsh-codex-community@0.0.2
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

- The `0.0.x` line does not promise a stable API; pin the exact version.
- Linux, macOS, and Windows CI/profile smoke for `0.0.2` reached `3/3`; the accepted commit and platform evidence are in the [acceptance record](docs/releases/v0.0.2.acceptance.json).
- Live OAuth, conversation, image, transport, and Fast network acceptance is `0/13 pending`. These unverified capabilities remain clearly disclosed and will be completed individually after publication.
- The settings page reads usage through the Web-backend compatibility endpoint used by the official Codex client. If that endpoint is unavailable or malformed, the page retains the latest safe reading and falls back to request observation or an unknown state instead of presenting the error as zero remaining usage.
- Model names, context windows, and maximum outputs come from the installed provider catalog. The reasoning picker exposes only subscription-Codex levels through Max that the Provider can fully implement, plus each model's verified default. Generic `Default`, `Off`, and `Minimal` entries are hidden, and agent-level `Ultra` is not disguised as a plain reasoning effort.
- Fast is limited to GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra and consumes more usage. Other models never receive the Fast service tier.
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
