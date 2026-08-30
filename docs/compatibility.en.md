# Compatibility and support boundaries

[简体中文](compatibility.md) | [English](compatibility.en.md)

Last updated: 2026-08-30.

`1.0.0` is the current stable release candidate and is not published. The table records targets and pending gates; it does not inherit candidate, platform, or live-account evidence from `0.0.4`. This version's acceptance draft is currently `0/3 pending` for platforms and `0/13 pending` for live-account checks.

| Component or environment | `1.0.0` development target | Status |
| --- | --- | --- |
| DeepSeek Harness | `test/fixtures/dsh-runtime/pnpm-lock.yaml` remains pinned to the `@deepseek-ai/dsh@0.1.1-rc.2` runtime/peer graph | This version's complete checks and profile smoke are pending |
| pi-ai | Pinned to `@earendil-works/pi-ai@0.82.1` with new request preferences, capability badges, and transport-health projection | This version's contract regression and live-network acceptance are pending |
| Node.js | Declared range `>=22.19.0 <25` | This version's local and three-platform Node 22/24 gates are pending |
| macOS | `macos-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | `pending` |
| Windows x64 | `windows-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | `pending` |
| Linux x64 | `ubuntu-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | `pending` |
| Real ChatGPT OAuth login | Automation does not read or modify a user's real grant | Controlled acceptance pending |
| Codex usage windows | Entry, visibility, reset boundaries, and `/codex-usage refresh` trigger account reads; the weekly under-24-hour threshold only changes local display; settings shows plan, consistent remaining usage, and safe reset time | This version's automation and live-account acceptance are pending |
| Codex model settings | Generic discovery plus an independent loopback-only read-only capability RPC provides compact `K` labels, input modalities, reasoning efforts exposed by the installed provider catalog, Fast, and selected/unselected ordering | This version's automation and local Chinese/English UI acceptance are pending; unavailable RPC data and unknown capabilities are not inferred |
| Real Codex conversation | Automation does not consume user account quota | Controlled acceptance pending |
| Text / reasoning / usage / tools / replay | Test coverage is inherited, not a pass result | `1.0.0` automation regression plus live reasoning, tool round trip, and continuity are pending |
| Codex image input | Attachment-seam and budget-projection coverage is inherited | `1.0.0` automation regression and a live request with `maxPixels=4194304` are pending |
| auto / SSE / WebSocket / cached | Transport-mapping and session-isolation coverage is inherited | `1.0.0` automation regression and one live request through each transport are pending |
| Fast / priority tier | The assertion that only an explicit per-session choice changes `service_tier` is inherited | `1.0.0` automation regression, account entitlement, and live network are pending |
| npm / GitHub Release | The strict workflow is expected to verify the candidate, Registry readback, provenance, signatures, and Release assets | `1.0.0` is unpublished; the current formal artifact remains [`v0.0.4`](https://github.com/yoshino-xiao7/dsh-codex/releases/tag/v0.0.4) |

`1.0.0` adds nine capabilities on top of the existing boundary: per-session reply verbosity, reasoning summaries, truthful model-capability badges, OAuth link/code copying, intelligent usage refresh, plan display, `/codex-usage refresh`, safe diagnostics copying, and per-conversation transport health. Capability badges come from an independent local read-only RPC. Diagnostics still own no stream seam and send no model request; transport health projects only sanitized process-local counters. Account diagnostics expose HTTP failures only as fixed 401/403 authentication, 429 rate-limit, 5xx server, or other HTTP categories. Automation, three-platform, and live-account evidence must bind to this version's candidate before these capabilities are described as verified.

`1.0.0` is published as a stable release while declaring only the exact DSH prerelease dependency target. Its candidate commit, Linux/macOS/Windows CI/profile smoke, maintainer approval, and live-account evidence remain pending in the [acceptance draft](releases/v1.0.0.acceptance.json). The previous [acceptance record](releases/v0.0.4.acceptance.json) remains historical evidence only and does not replace this version's gates.

The root `pnpm-lock.yaml` locks plugin dependencies, while `test/fixtures/dsh-runtime/pnpm-lock.yaml` independently locks the complete DSH runtime and peer graph used by compatibility smoke. CI runs `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts` instead of handing that peer graph to direct npm resolution, avoiding nondeterministic dependency results and uncontrolled memory use. This frozen layer verifies Web/profile integration; it does not claim coverage of native terminal or native-build capabilities in DSH dependencies that require lifecycle scripts. Dependency upgrades must use a pinned-version PR, update and review both lockfiles, repeat complete CI, profile smoke, and supply-chain verification before publication, and renew controlled live validation afterward. The scheduled compatibility workflow only verifies the current locked graph and reports Registry drift; neither a broad semver range nor one scheduled run proves cross-RC compatibility.

## Profile composition

The `1.0.0` bundle does not modify the general `llm-pi-ai` Cordis row. It provides:

- the `dsh-codex` route;
- the `dsh-codex` settings namespace;
- the `dsh-codex/openai-codex` OAuth credential record and sign-in flow.

Other pi-ai providers remain usable in the same profile. This plugin does not register a general configurable-provider directory; its settings page manages model selection. If the user also enables the general `openai-codex` route, the model selector shows two Codex provider groups with different routes. The two credential scopes neither read nor migrate each other.

## Model and session capabilities

The model catalog comes from the installed pi-ai `0.82.1`; it is not a live online directory. The settings page requires at least one selected model. Selecting all removes the model override and follows future catalog versions only when entries have no custom fields. Partial selections or entries with custom fields retain explicit configuration. An absent `models` value advertises the complete catalog, while an explicit empty array advertises none; exact hidden models remain resolvable, so catalog filtering does not invalidate older sessions.

Images are sent only to models that declare `image` input. A text-only model rejects an image before provider I/O.

Fast, transport, reply-verbosity, and reasoning-summary preferences set by `/codex` exist only for the current process and session. Restarting, removing the plugin, or running `/codex reset` restores defaults and clears exact-session transport-health counters. Fast is off by default and a failure is not replayed automatically on a lower tier.

## Credentials and capability boundaries

- The Codex route accepts ChatGPT OAuth only and does not read an OpenAI Platform API key.
- Cancel sign-in through the plugin settings page or `/codex-login cancel`: cancellation succeeds before write linearization, while an in-progress commit is reported as too late and remains observed through its final state; `logout` always deletes the credential. The current DSH public seam has no post-commit cancellation barrier, so third-party code that calls `ctx.authorization.cancel()` directly bypasses this coordination and is not a supported `1.0.0` interaction path.
- When a plugin or hot-reload flow owner is disposed, sign-in is cancelled before commit selection, while a selected credential commit is allowed to reach its final write before disposal completes. An unsupported or malformed stored record is shown as `invalid`, requires signing in again or signing out to clear it, and is never presented as signed in.
- The usage card reads real five-hour and weekly limits when settings opens, becomes visible again, reaches a reset boundary, or is refreshed manually; the weekly under-24-hour threshold rerenders locally only. `/codex-usage refresh` uses the same reader, while `status` reads only the process-local `QuotaObserver`. The Host returns only strictly parsed windows, percentages, reset times, and an optional plan type, never OAuth credentials or raw responses. If the endpoint is unavailable or malformed, the latest safe reading is retained and the card falls back to request observation or an unknown state rather than presenting the failure as zero remaining usage.
- DSH Web search uses its own provider and credentials; it does not reuse ChatGPT OAuth.
- `1.0.0` does not provide image generation or editing.
- Session compaction continues to use DSH's built-in automatic compaction and `/compact`.
