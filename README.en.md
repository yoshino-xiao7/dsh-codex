# dsh-codex

[简体中文](README.md) | [English](README.en.md)

A Codex plugin for DeepSeek Harness with ChatGPT OAuth sign-in, Codex models, image input, and reliable streaming responses.

> Current version: `0.0.1` technical preview. npm package: `dsh-codex-community`.

## Features

- Sign in, sign in again, or sign out of ChatGPT OAuth from DSH Web;
- select and enable Codex models with streaming text, reasoning, usage, tool calls, and session replay;
- use DSH Web's native image paste, drag-and-drop, and attachment flow;
- let `read_image` safely read HTTP(S) images with address, redirect, format, size, and timeout limits;
- provide valid pixel and byte budgets for request images, preventing invalid `maxPixels` values;
- classify `AccountQuotaExceeded` as non-retryable account quota and show a sanitized reset time;
- preserve safe partial text after a stream failure, while incomplete tool calls stop without replaying the request;
- use `/codex` to choose Fast and transport for the current session, with Fast off and transport automatic by default.

## Requirements

- DeepSeek Harness `0.1.1-rc.2`
- Node.js `>=22.19.0 <25`

## Installation

Install an exact version:

```sh
dsh plugin --profile web add dsh-codex-community@0.0.1
dsh web
```

## Sign in and use

1. Open **Settings → Codex sign-in** and complete the ChatGPT OAuth prompts.
2. Enable models on the same page.
3. Choose a Codex model from the conversation model selector.

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

Fast and transport preferences are kept only for the current session in the current process; they are not persisted. Fast requests the priority service tier, whose availability depends on the account and service; a failure is not automatically replayed on a lower tier.

Update:

```sh
dsh plugin --profile web update dsh-codex-community@0.0.1
dsh web
```

Before removal, sign out under **Settings → Codex sign-in**, then run:

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
- Quota state comes from recent requests; it is not a live balance or proactive account query.
- Fast is an explicitly enabled experimental capability; real account entitlement still requires pre-release acceptance.
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
