# Compatibility and support boundaries

[简体中文](compatibility.md) | [English](compatibility.en.md)

Last updated: 2026-08-31.

`1.1.1` is the current stable release. Its complete checks and Linux, macOS, and Windows CI/profile smoke passed `3/3` against this release candidate and were approved by the maintainer. Post-release live-account validation starts at `0/13` and inherits no older evidence.

| Component or environment | `1.1.1` compatibility target | Status |
| --- | --- | --- |
| DeepSeek Harness | `test/fixtures/dsh-runtime/pnpm-lock.yaml` remains pinned to the `@deepseek-ai/dsh@0.1.1-rc.2` runtime/peer graph | Complete checks and profile smoke passed |
| pi-ai | Pinned to `@earendil-works/pi-ai@0.82.1` with global request defaults, sparse conversation overrides, transport generations, and a one-shot diagnostic seam | Contract regression passed; live-network acceptance is recorded after release |
| Node.js | Declared range `>=22.19.0 <25` | Local and three-platform Node 22/24 gates passed |
| macOS | `macos-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | `passed` |
| Windows x64 | `windows-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | `passed` |
| Linux x64 | `ubuntu-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | `passed` |
| Real ChatGPT OAuth login | Automation does not read or modify a user's real grant | Controlled acceptance pending |
| Codex usage windows | Entry, visibility, reset boundaries, and `/codex-usage refresh` trigger account reads; the weekly under-24-hour threshold only changes local display; settings shows plan, consistent remaining usage, and safe reset time | Automation regression passed; live-account acceptance is recorded after release |
| Codex model settings | Generic discovery plus an independent loopback-only read-only capability RPC provides compact `K` labels, input modalities, reasoning efforts exposed by the installed provider catalog, Fast, and selected/unselected ordering | Automation and three-platform profile smoke passed; unavailable RPC data and unknown capabilities are not inferred |
| Real Codex conversation | Automation does not consume user account quota | Controlled acceptance pending |
| Text / reasoning / usage / tools / replay | Automation covers text, reasoning, usage, tool, and replay contracts | Automation regression passed; live reasoning, tool round trip, and continuity are accepted after release |
| Codex image input | Automation covers the attachment seam and budget projection | Automation regression passed; a live request with `maxPixels=4194304` is accepted after release |
| auto / SSE / WebSocket / cached | Automation covers transport mapping and session isolation | Automation regression passed; one live request through each transport is accepted after release |
| Fast / priority tier | Automation asserts that only an explicit current-session choice changes `service_tier` | Automation regression passed; account entitlement and live network are accepted after release |
| npm / GitHub Release | The strict workflow verifies the candidate, Registry readback, provenance, signatures, and Release assets | Stable [`v1.1.1`](https://github.com/yoshino-xiao7/dsh-codex/releases/tag/v1.1.1) |

`1.1.1` precisely recognizes pi-ai's fixed Codex overload failure and brings it into the existing bounded-retry contract. After safe text appears, it preserves the content and directs the user to continue manually; full-request replay remains disabled after tool execution starts. It inherits `1.1.0` global defaults, usage reminders, one-shot real-network diagnostic, and sanitized in-memory history without changing their request or privacy contracts.

`1.1.1` is published as a stable release while still declaring only the exact DSH prerelease dependency target. Its candidate commit, Linux/macOS/Windows CI/profile smoke, and maintainer approval are recorded in this version's [acceptance record](releases/v1.1.1.acceptance.json). Live-account validation is disclosed at `0/13` and continues after release. Records for `1.1.0` and older releases remain historical evidence only and do not replace this version's gates.

The root `pnpm-lock.yaml` locks plugin dependencies, while `test/fixtures/dsh-runtime/pnpm-lock.yaml` independently locks the complete DSH runtime and peer graph used by compatibility smoke. CI runs `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts` instead of handing that peer graph to direct npm resolution, avoiding nondeterministic dependency results and uncontrolled memory use. This frozen layer verifies Web/profile integration; it does not claim coverage of native terminal or native-build capabilities in DSH dependencies that require lifecycle scripts. Dependency upgrades must use a pinned-version PR, update and review both lockfiles, repeat complete CI, profile smoke, and supply-chain verification before publication, and renew controlled live validation afterward. The scheduled compatibility workflow only verifies the current locked graph and reports Registry drift; neither a broad semver range nor one scheduled run proves cross-RC compatibility.

## Profile composition

The `1.1.1` bundle does not modify the general `llm-pi-ai` Cordis row. It provides:

- the `dsh-codex` route;
- the `dsh-codex` settings namespace;
- the `dsh-codex/openai-codex` OAuth credential record and sign-in flow.

Other pi-ai providers remain usable in the same profile. This plugin does not register a general configurable-provider directory; its settings page manages model selection. If the user also enables the general `openai-codex` route, the model selector shows two Codex provider groups with different routes. The two credential scopes neither read nor migrate each other.

## Model and session capabilities

The model catalog comes from the installed pi-ai `0.82.1`; it is not a live online directory. The settings page requires at least one selected model. Selecting all removes the model override and follows future catalog versions only when entries have no custom fields. Partial selections or entries with custom fields retain explicit configuration. An absent `models` value advertises the complete catalog, while an explicit empty array advertises none; exact hidden models remain resolvable, so catalog filtering does not invalidate older sessions.

Images are sent only to models that declare `image` input. A text-only model rejects an image before provider I/O.

Fast, Transport, reply verbosity, and reasoning summary in plugin settings are persistent global defaults. `/codex` stores only explicit sparse overrides for one exact conversation in the current process. Restart clears conversation overrides while retaining global defaults, and `/codex reset` makes the current conversation inherit those defaults again; transport-health counters clear with the exact conversation. Fast is off by default and a failure is not replayed automatically on a lower tier.

## Credentials and capability boundaries

- The Codex route accepts ChatGPT OAuth only and does not read an OpenAI Platform API key.
- Cancel sign-in through the plugin settings page or `/codex-login cancel`: cancellation succeeds before write linearization, while an in-progress commit is reported as too late and remains observed through its final state; `logout` always deletes the credential. The current DSH public seam has no post-commit cancellation barrier, so third-party code that calls `ctx.authorization.cancel()` directly bypasses this coordination and is not a supported `1.1.1` interaction path.
- When a plugin or hot-reload flow owner is disposed, sign-in is cancelled before commit selection, while a selected credential commit is allowed to reach its final write before disposal completes. An unsupported or malformed stored record is shown as `invalid`, requires signing in again or signing out to clear it, and is never presented as signed in.
- The usage card reads real five-hour and weekly limits when settings opens, becomes visible again, reaches a reset boundary, or is refreshed manually; the weekly under-24-hour threshold rerenders locally only. `/codex-usage refresh` uses the same reader, while `status` reads only the process-local `QuotaObserver`. The Host returns only strictly parsed windows, percentages, reset times, and an optional plan type, never OAuth credentials or raw responses. If the endpoint is unavailable or malformed, the latest safe reading is retained and the card falls back to request observation or an unknown state rather than presenting the failure as zero remaining usage.
- DSH Web search uses its own provider and credentials; it does not reuse ChatGPT OAuth.
- `1.1.1` does not provide image generation or editing.
- Session compaction continues to use DSH's built-in automatic compaction and `/compact`.
