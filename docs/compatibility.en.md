# Compatibility and support boundaries

[简体中文](compatibility.md) | [English](compatibility.en.md)

Last updated: 2026-08-29.

| Component or environment | `0.0.1` evidence | Status |
| --- | --- | --- |
| DeepSeek Harness | `test/fixtures/dsh-runtime/pnpm-lock.yaml` locks the complete `@deepseek-ai/dsh@0.1.1-rc.2` runtime/peer graph and validates the `dsh-llm` schema and stream contract | Exact version verified |
| pi-ai | OAuth, catalog, Codex payload, and replay contract tests against `@earendil-works/pi-ai@0.82.1` | Public contract verified; real sign-in pending |
| Node.js | Complete local suite on `22.22.2`; [CI run 33224023141](https://github.com/yoshino-xiao7/dsh-codex/actions/runs/33224023141) covers 22 and 24 on all three operating systems | `>=22.19.0 <25` |
| macOS arm64 | Local tests, build, attachment seam, and isolated profile startup; `macos-latest` CI passes on Node 22 and 24 | Local and CI automation verified |
| Windows x64 | `windows-latest` CI on Node 22 and 24 completes the frozen DSH install, 299 checks, release-draft verification, exact-candidate install, and disposable Web/profile startup | CI automation verified; real user environment pending |
| Linux x64 | `ubuntu-latest` CI on Node 22 and 24 completes the same checks and Web/profile smoke | CI automation verified |
| Real ChatGPT OAuth login | Automation does not read or modify a user's real grant | Controlled acceptance pending |
| Real Codex conversation | Automation does not consume user account quota | Controlled acceptance pending |
| Text / reasoning / usage / tools / replay | Public PiAiAdapter success, tool-call, and two-turn replay automation passes | Live reasoning, tool round trip, and conversation continuity are pending |
| Codex image input | Attachment-seam and budget-projection automation passes | A live request with `maxPixels=4194304` is pending |
| auto / SSE / WebSocket / cached | Transport mapping and session isolation pass in automation | One live request through each transport is pending |
| Fast / priority tier | Verified that only an explicit per-session choice changes `service_tier` | Account entitlement and live network pending |
| npm / GitHub Release | The strict workflow verifies the candidate, registry readback, and Release assets | Refer to the public Registry/Release records |

The `0.0.x` line is a technical preview and declares compatibility only with the exact DSH prerelease above. The root `pnpm-lock.yaml` locks plugin dependencies, while `test/fixtures/dsh-runtime/pnpm-lock.yaml` independently locks the complete DSH runtime and peer graph used by compatibility smoke. CI runs `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts` instead of handing that peer graph to direct npm resolution, avoiding nondeterministic dependency results and uncontrolled memory use. This frozen layer verifies Web/profile integration; it does not claim coverage of native terminal or native-build capabilities in DSH dependencies that require lifecycle scripts. Dependency upgrades must use a pinned-version PR, update and review both lockfiles, then complete full CI, profile smoke, and controlled acceptance. The scheduled compatibility workflow only verifies the current locked graph and reports Registry drift; neither a broad semver range nor one scheduled run proves cross-RC compatibility.

## Profile composition

The `0.0.1` bundle does not modify the general `llm-pi-ai` Cordis row. It adds:

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
- Cancel sign-in through the plugin settings page or `/codex-login cancel`: cancellation succeeds before write linearization, while an in-progress commit is reported as too late and remains observed through its final state; `logout` always deletes the credential. The current DSH public seam has no post-commit cancellation barrier, so third-party code that calls `ctx.authorization.cancel()` directly bypasses this coordination and is not a supported `0.0.1` interaction path.
- When a plugin or hot-reload flow owner is disposed, sign-in is cancelled before commit selection, while a selected credential commit is allowed to reach its final write before disposal completes. An unsupported or malformed stored record is shown as `invalid`, requires signing in again or signing out to clear it, and is never presented as signed in.
- The quota card shows recent request-derived observations, not a live balance, percentage, or proactive account query.
- DSH Web search uses its own provider and credentials; it does not reuse ChatGPT OAuth.
- `0.0.1` does not provide image generation or editing.
- Session compaction continues to use DSH's built-in automatic compaction and `/compact`.
