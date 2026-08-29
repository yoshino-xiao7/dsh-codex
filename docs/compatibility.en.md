# Compatibility and support boundaries

[简体中文](compatibility.md) | [English](compatibility.en.md)

Last updated: 2026-08-29.

| Component or environment | `0.0.2` evidence | Status |
| --- | --- | --- |
| DeepSeek Harness | `test/fixtures/dsh-runtime/pnpm-lock.yaml` locks the complete `@deepseek-ai/dsh@0.1.1-rc.2` runtime/peer graph and validates the `dsh-llm` schema and stream contract | Exact version verified |
| pi-ai | OAuth, catalog, Codex payload, and replay contract tests against `@earendil-works/pi-ai@0.82.1` | Public contract verified; 0.0.2 live-network acceptance is `0/13 pending` |
| Node.js | Complete local suite on `22.22.2`; the [0.0.2 three-platform candidate run](https://github.com/yoshino-xiao7/dsh-codex/actions/runs/33243698807) covers Node 22/24 | `>=22.19.0 <25`; candidate run passed |
| macOS | `macos-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | Platform gate passed |
| Windows x64 | `windows-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | Platform gate passed; real user environment pending |
| Linux x64 | `ubuntu-latest` Node 22/24 complete checks, frozen DSH installation, and Web/profile smoke | Platform gate passed |
| Real ChatGPT OAuth login | Automation does not read or modify a user's real grant | Controlled acceptance pending |
| Codex usage windows | Opening the settings page and refreshing manually both make the Host actively read and strictly parse the real five-hour and weekly limits; both windows were verified in the local DSH settings page | Verified; a failure retains the latest safe reading or falls back to request observation/an unknown state |
| Real Codex conversation | Automation does not consume user account quota | Controlled acceptance pending |
| Text / reasoning / usage / tools / replay | Public PiAiAdapter success, tool-call, and two-turn replay automation passes | Live reasoning, tool round trip, and conversation continuity are pending |
| Codex image input | Attachment-seam and budget-projection automation passes | A live request with `maxPixels=4194304` is pending |
| auto / SSE / WebSocket / cached | Transport mapping and session isolation pass in automation | One live request through each transport is pending |
| Fast / priority tier | Verified that only an explicit per-session choice changes `service_tier` | Account entitlement and live network pending |
| npm / GitHub Release | The strict workflow verifies the candidate, Registry readback, provenance, signatures, and Release assets; artifacts are attached to [`v0.0.2`](https://github.com/yoshino-xiao7/dsh-codex/releases/tag/v0.0.2) | Formal publication is performed by the protected workflow |

The `0.0.x` line is a technical preview and declares compatibility only with the exact DSH release candidate above. Linux, macOS, and Windows CI/profile smoke for `0.0.2` reached `3/3`; the accepted commit, exact Node versions, and job links are recorded in the [acceptance record](releases/v0.0.2.acceptance.json), with maintainer approval. Live OAuth, conversation, image, transport, and Fast network acceptance remains `0/13 pending` for post-release validation and will be completed individually after publication. These incomplete checks must remain visible and must never be presented as verified capabilities. Reading the usage windows was verified independently in the local settings page and is not one of these 13 checks that consume a model request or require a complete interaction round trip.

The root `pnpm-lock.yaml` locks plugin dependencies, while `test/fixtures/dsh-runtime/pnpm-lock.yaml` independently locks the complete DSH runtime and peer graph used by compatibility smoke. CI runs `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts` instead of handing that peer graph to direct npm resolution, avoiding nondeterministic dependency results and uncontrolled memory use. This frozen layer verifies Web/profile integration; it does not claim coverage of native terminal or native-build capabilities in DSH dependencies that require lifecycle scripts. Dependency upgrades must use a pinned-version PR, update and review both lockfiles, repeat complete CI, profile smoke, and supply-chain verification before publication, and renew controlled live validation afterward. The scheduled compatibility workflow only verifies the current locked graph and reports Registry drift; neither a broad semver range nor one scheduled run proves cross-RC compatibility.

## Profile composition

The `0.0.2` bundle does not modify the general `llm-pi-ai` Cordis row. It provides:

- the `dsh-codex` route;
- the `dsh-codex` settings namespace;
- the `dsh-codex/openai-codex` OAuth credential record and sign-in flow.

Other pi-ai providers remain usable in the same profile. This plugin does not register a general configurable-provider directory; its settings page manages model selection. If the user also enables the general `openai-codex` route, the model selector shows two Codex provider groups with different routes. The two credential scopes neither read nor migrate each other.

## Model and session capabilities

The model catalog comes from the installed pi-ai `0.82.1`; it is not a live online directory. The settings page requires at least one selected model. Selecting all removes the model override and follows future catalog versions only when entries have no custom fields. Partial selections or entries with custom fields retain explicit configuration. An absent `models` value advertises the complete catalog, while an explicit empty array advertises none; exact hidden models remain resolvable, so catalog filtering does not invalidate older sessions.

Images are sent only to models that declare `image` input. A text-only model rejects an image before provider I/O.

Fast and transport preferences set by `/codex` exist only for the current process and session. Restarting, removing the plugin, or running `/codex reset` restores defaults. Fast is off by default and a failure is not replayed automatically on a lower tier.

## Credentials and capability boundaries

- The Codex route accepts ChatGPT OAuth only and does not read an OpenAI Platform API key.
- Cancel sign-in through the plugin settings page or `/codex-login cancel`: cancellation succeeds before write linearization, while an in-progress commit is reported as too late and remains observed through its final state; `logout` always deletes the credential. The current DSH public seam has no post-commit cancellation barrier, so third-party code that calls `ctx.authorization.cancel()` directly bypasses this coordination and is not a supported `0.0.2` interaction path.
- When a plugin or hot-reload flow owner is disposed, sign-in is cancelled before commit selection, while a selected credential commit is allowed to reach its final write before disposal completes. An unsupported or malformed stored record is shown as `invalid`, requires signing in again or signing out to clear it, and is never presented as signed in.
- The usage card actively reads the real five-hour and weekly limits when the settings page opens and when the user refreshes it manually. The Host returns only strictly parsed windows, percentages, and reset times to the Web page, never OAuth credentials or raw responses. If the endpoint is unavailable or malformed, the latest safe reading is retained and the card falls back to request observation or an unknown state rather than presenting the failure as zero remaining usage.
- DSH Web search uses its own provider and credentials; it does not reuse ChatGPT OAuth.
- `0.0.2` does not provide image generation or editing.
- Session compaction continues to use DSH's built-in automatic compaction and `/compact`.
