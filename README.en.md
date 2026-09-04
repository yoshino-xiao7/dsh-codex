# dsh-codex

[简体中文](README.md) | [English](README.en.md)

A Codex plugin for DeepSeek Harness with ChatGPT OAuth sign-in, Codex models, image input, and reliable streaming responses.

> Current version: `1.2.1` stable release, published through npm `latest` and a full GitHub Release. npm package: `dsh-codex-community`.

## Features

- Sign in, sign in again, or sign out of ChatGPT OAuth from DSH Web;
- select and enable Codex models with streaming text, reasoning, usage, tool calls, and session replay;
- use DSH Web's native image paste, drag-and-drop, and attachment flow;
- let `read_image` safely read HTTP(S) images with address, redirect, format, size, and timeout limits;
- provide valid pixel and byte budgets for request images, preventing invalid `maxPixels` values;
- classify `AccountQuotaExceeded` as non-retryable account quota and show a sanitized reset time;
- classify the known Codex overload failure as a bounded-retry server error, preserving safe text while continuing to forbid full-request replay after tool execution starts;
- preserve safe partial text after a stream failure, while incomplete tool calls stop without replaying the request;
- actively refresh real five-hour and weekly limits when settings opens, the page becomes visible again, or a usage-window reset boundary is reached, with immediate refresh through the button or `/codex-usage refresh`; weekly relative-day decrements and the under-24-hour transition update local time display only;
- present one consistent remaining-usage meaning in compact cards, including the safe plan type and reset time; five-hour limits always use exact time and weekly limits do so inside 24 hours;
- list selected models first in settings and collapse unselected models by default, with compact `K` labels taken from the current provider catalog for context and maximum output;
- use the lightning button to the left of the model selector for official Fast (1.5×), and use the adjacent graphical button or `/codex` to select Auto, SSE, WebSocket, or cached WebSocket transport for the current conversation;
- read input modalities, selectable reasoning efforts actually exposed by the installed provider catalog, and Fast support through an independent local loopback-only read-only Host RPC, merge them with Harness's generic catalog, and omit badges for unavailable or unknown capabilities instead of inferring them;
- choose current-session reply verbosity (low, medium, or high) and reasoning-summary style (auto, concise, detailed, or off), effective on the next request;
- copy the OAuth sign-in link and verification code separately; copying occurs only after an explicit user click and does not log short-lived credentials;
- run an on-demand local or account check from collapsed connection diagnostics and copy a sanitized report containing only fixed statuses and bounded facts;
- inspect sanitized per-conversation transport health, including request count, connection reuse, delta context, and SSE fallbacks.

Compatibility fix in `1.2.1`:

- support the Harness `0.1.2-rc.1` typed-remote model-management APIs, restoring model discovery, selection, and persistence while retaining the legacy connection fallback;
- display the internal `gpt-reserve` quota group as “Usage limit reset”.

Compatibility fix in `1.2.0`:

- Adapt to the DeepSeek Harness `0.1.2-rc.1` settings service API and register the `dsh-codex` namespace with `ctx.settings.installSection`;
- Scan every packed `dist/**` file so an internal chunk cannot retain the removed `installSettingsSection` / `settingsNamespace` imports;
- Switch the Web client inject list to `dsh-client-ui-renderer` instead of the unpublished `dsh-client-runtime` package.

Maintenance in `1.1.2`:

- update Cordis `4.0.2`, Schemastery `3.18.2`, pi-ai `0.84.4`, and TypeScript `7.0.2`, while explicitly pinning the supporting dependencies required by the Harness runtime;
- enable strict peer-dependency installation checks so incompatible runtime combinations fail during build and CI;
- give release-candidate npm audits bounded retries and per-attempt timeouts for transient Registry or network failures, while real vulnerabilities and exhausted retries remain fail-closed.

Added in `1.1.0`:

- persist global defaults for Fast, Transport, reply verbosity, and reasoning summary in plugin settings; conversations retain only explicit overrides, and `/codex reset` restores the current global defaults;
- show low-usage, exhausted-window, and reset-refresh reminders from verified five-hour and weekly readings while the app is running, without background polling or operating-system notifications;
- provide a one-shot real-network diagnostic whose confirmation names the model that will be validated; only after the user reads the usage warning and confirms again does it send one short prompt over SSE with Fast off. The request follows the public Codex SDK wire schema, carries no conversation history or tools, and has no automatic retry. The dedicated endpoint exposes no usable server-side hard output limit; the plugin tears down the stream after the first visible model text, but cancellation or teardown cannot guarantee that no usage was consumed;
- retain at most 20 sanitized diagnostic reports in process memory and export only the validated safe JSON projection; restarting the process clears the history.

## Requirements

- DeepSeek Harness `0.1.2-rc.1`
- Node.js `>=22.19.0 <25`

## Installation

Install the exact version:

```sh
dsh plugin --profile web add dsh-codex-community@1.2.1
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

`1.1.0` makes off, `auto`, `low`, and `auto` persistent safe global defaults; a conversation stores only fields the user explicitly changes, so untouched fields follow later default changes. Every change applies to the next request. For GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra, Fast uses the official priority service tier, targets 1.5× speed, and consumes more usage. A failed request is not replayed automatically on a lower tier.

Update:

```sh
dsh plugin --profile web update dsh-codex-community@1.2.1
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
- Codex service overload: failures before output use the existing bounded retry policy. After safe text appears, the plugin preserves it and stops with guidance to send “continue” later; it never replays the full request after tool execution starts.
- A response stops halfway: plain text can be preserved safely; an incomplete tool call is not replayed, avoiding duplicate side effects.

See [Troubleshooting](docs/troubleshooting.en.md) for diagnostic steps.

## Support boundaries

- Complete checks and Linux, macOS, and Windows CI/profile smoke for `1.2.1` passed `3/3` against this candidate and were approved by the maintainer. Post-release live-account validation starts at `0/13`; see the [acceptance record](docs/releases/v1.2.1.acceptance.json).
- Historical `1.2.0` and older release evidence remains available but is not inherited as `1.2.1` acceptance.
- The settings page reads usage through the Web-backend compatibility endpoint used by the official Codex client. If that endpoint is unavailable or malformed, the page retains the latest safe reading and falls back to request observation or an unknown state instead of presenting the error as zero remaining usage.
- Model names, context windows, maximum outputs, and selectable Low-through-Max reasoning efforts follow the actual semantics of the installed provider catalog. The plugin neither invents nor labels a default effort that the catalog does not provide; when no effort is explicit, the current Provider or service applies its default behavior. Generic `Default`, `Off`, and `Minimal` entries are hidden, and agent-level `Ultra` is not disguised as a plain reasoning effort.
- Fast is limited to GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, and Terra and consumes more usage. Other models never receive the Fast service tier.
- Local and account diagnostics send no model request. The one-shot real-network diagnostic uses the model listed in the confirmation to send one short prompt and consume usage only after a second confirmation. It has no server-side hard output limit and only tears down after the first visible text, so it still does not replace complete acceptance for images, tools, Fast, or every transport.
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
