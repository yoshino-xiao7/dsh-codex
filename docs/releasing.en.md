# Release process

[简体中文](releasing.md) | [English](releasing.en.md)

Versioning begins at `0.0.1`. The `0.0.x` line is a technical preview, and every GitHub Release requires complete Chinese and English copy.

## Preparation

1. Create a clearly named release branch from `main`;
2. update `package.json`, `CHANGELOG.md`, the README feature and support-boundary statements, compatibility date, and `docs/releases/v<version>.md`;
3. confirm package name, repository URL, license, peer range, and `dsh.bundle`;
4. review and update both the root `pnpm-lock.yaml` and `test/fixtures/dsh-runtime/pnpm-lock.yaml`; never update only one dependency graph;
5. require green Linux, macOS, and Windows CI before merge;
6. use a controlled test account for required real acceptance without recording tokens, OAuth codes, cookies, or account credentials.

## Two gate levels

Regular CI uses draft mode. It permits `TBD` and `pending`, while checking the version, bilingual Release structure, and acceptance-record shape so unreleased work remains continuously testable:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run verify:release
```

`npm publish` uses strict mode. Publication fails before any network write if any of these conditions is unmet:

- the Release body still contains `TBD`, `pending`, `draft`, `unreleased`, or the corresponding Chinese placeholders;
- `docs/releases/v<version>.acceptance.json` is not `approved`;
- `smoke:dsh-profile` on Linux, macOS, and Windows, or any fixed live check for ChatGPT OAuth, models, text/reasoning streams, usage, the tool round trip, replay, images, transports, and Fast has not passed;
- timestamps, runner details, Node versions, approver, or HTTPS evidence links are missing;
- files outside the permitted release-evidence set changed after the accepted commit; only the bilingual Release body, acceptance JSON, bilingual READMEs, `CHANGELOG.md`, and bilingual compatibility documents may be updated to clear publication state;
- the `.tgz`, SHA-256, SRI, locked reference SBOM, actual install trees, production-dependency audit, or isolated-import evidence is missing or inconsistent.

Both the release workflow and `prepublishOnly` invoke the strict command:

```sh
pnpm run verify:release:publish
```

Do not bypass the gate with fabricated environment variables. Keep the release in draft state until real evidence exists.
`prepublishOnly` protects publication from a repository checkout. npm does not run that lifecycle when publishing an existing tarball, so the workflow explicitly runs the strict gate immediately before publishing that same `.tgz` and requests a short-lived OIDC identity token only after the protected environment approves the job.

## Acceptance record

1. Run cross-platform CI and live-network acceptance against a committed release candidate.
2. Put that candidate's full 40-character commit in `testedCommit`.
3. Run the profile smoke on all three operating systems with exact DSH `0.1.1-rc.2` and a tested Node 22 release (at least `22.19.0`) or Node 24, then record `testedAt`, environment details, and HTTPS evidence links without sensitive parameters.
4. Use a controlled test account to complete every live check below. Mark a check `passed` only after every fixed assertion has sanitized evidence; a free-form scope statement is not a substitute.
5. After every item passes, a maintainer records approval and changes `releaseStatus` to `approved`.
6. From that point, only `docs/releases/v<version>.md`, its acceptance JSON, `README.md`, `README.en.md`, `CHANGELOG.md`, `docs/compatibility.md`, and `docs/compatibility.en.md` may change to record dates, evidence, and publication state. Any source, configuration, dependency, lockfile, or workflow change requires acceptance against a new commit.

| Check | Required proof |
| --- | --- |
| `oauthWebSignIn` | OAuth starts from DSH Settings, the credential becomes configured, and a post-sign-in request succeeds |
| `modelCatalog` | Settings shows the catalog and the conversation model selector can select a Codex model |
| `textStream` | A non-empty text delta and a normal terminal event are observed |
| `reasoningStream` | A reasoning block is observed and the request terminates normally |
| `terminalUsage` | Terminal usage contains both input and output token counts |
| `toolRoundTrip` | A safe test tool is requested, executed, returned, and followed by a successful response |
| `replayContinuity` | Two turns succeed and the second correctly uses first-turn context |
| `imageMaxPixels` | Native image input succeeds and the request projects `maxPixels=4194304` |
| `transportAuto` / `transportSse` / `transportWebsocket` | At least one live request succeeds through each transport |
| `transportWebsocketCached` | Two consecutive turns succeed in the same session |
| `fastPriority` | Priority is requested, the live request succeeds, and no automatic downgrade replay occurs |

Each check contains only `status`, `testedAt`, an HTTPS `evidenceUrl` without query data, and the gate-defined boolean `assertions`. Evidence must not contain a token, OAuth code, cookie, account identifier, or complete private conversation.

macOS/Linux:

```sh
DSH_BIN=/path/to/dsh pnpm run smoke:dsh-profile
```

Windows PowerShell:

```powershell
$env:DSH_BIN = "C:\path\to\dsh.exe"
pnpm run smoke:dsh-profile
```

Before publication, fill in the Release date and accepted commit from `testedCommit`, then remove every placeholder. The workflow records the exact release commit used to build the artifact in the isolated-import evidence and uploads it as an asset.

## Artifact gate

The release workflow runs these stages in order:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run verify:release
npm pack --ignore-scripts --json --pack-destination release
pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts
# Generate SHA-256, SRI, and the locked reference SBOM from the final tarball, then capture actual install trees, audit production dependencies, and import in isolation
pnpm run verify:release:publish
```

Build the `.tgz` exactly once, then generate SHA-256, SRI, and a CycloneDX SBOM. The SRI must exactly equal the npm Registry `dist.integrity` readback; comparing only an algorithm prefix or a reformatted value is insufficient.

The CycloneDX SBOM is a **locked reference dependency graph** generated offline from the committed `pnpm-lock.yaml` and package manifest. It proves what the candidate source declares and locks; it does not claim to be the complete tree produced by a particular installation. The generator runs only `pnpm list --prod --json --depth Infinity --lockfile-only`; it never runs `npm install`, `npm sbom`, or re-resolves dependencies from the Registry. The output is deduplicated and stably sorted, omits local absolute paths and download URLs, binds the tarball SHA-256, lockfile SHA-256, and package dependency-descriptor SHA-256, and verifies that the artifact's package name, version, license, repository, and production/peer dependency descriptors match the repository manifest.

The root `pnpm-lock.yaml` locks the plugin's build and release dependencies. `test/fixtures/dsh-runtime/pnpm-lock.yaml` separately locks the complete DSH runtime and peer graph used by compatibility smoke. CI, compatibility monitoring, and release candidates all run `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts`; they never resolve an unbounded peer graph at runtime through `npm install @deepseek-ai/dsh@...`. Direct npm resolution can consume uncontrolled memory and can produce a different runtime for identical source as Registry state changes.

That same artifact is then installed into an isolated profile by the fixture's exact `0.1.1-rc.2` DSH runtime for a Web startup smoke, and it is also installed with `--ignore-scripts` in an empty directory and imported as a Host plugin. The two actual installations are recorded separately as `dsh-runtime-dependency-tree.json` and `isolated-dependency-tree.json`, alongside the reference SBOM. Only after the Web/profile smoke passes does the workflow generate `dsh-runtime-environment.json`, recording the DSH version, fixture-lock SHA-256, complete Node version, pnpm version, platform, architecture, and disabled-lifecycle-script state; the strict gate recomputes and verifies those values from the release commit. The isolated install also runs `npm audit --omit=dev --audit-level=high --json` and saves `npm-audit.json`; any high or critical production-dependency vulnerability blocks publication. The candidate job has only `contents: read`, and its artifact plus evidence are retained for 90 days. The publication job receives `contents: write` and `id-token: write` only when `publish=true`, the ref is `refs/heads/main`, and the protected `npm-release` environment approves it.

Because the frozen fixture uses `--ignore-scripts`, this layer proves DSH Web/profile compatibility with this plugin; it does not claim to validate native terminal or native-build capabilities in DSH dependencies that require lifecycle scripts.

An upgrade to DSH, pi-ai, or another runtime dependency must update and review both lockfiles, confirm that the fixture still pins only the intended DSH version, and rerun complete cross-platform CI, profile smoke, and controlled live acceptance. A scheduled Registry drift report does not replace this upgrade process.

## Release environment

Create `npm-release` under **GitHub repository Settings → Environments**:

1. configure at least one required reviewer;
2. restrict deployment branches to `main`;
3. do not add a normal repository-level npm token; only during the first-publish bootstrap, temporarily add the environment secret `NPM_BOOTSTRAP_TOKEN`;
4. have the releaser manually dispatch the workflow and approve the environment only after checking the version, commit, and candidate job.

The release workflow pins npm `11.16.0` and verifies and records that exact version before any network write. Trusted Publishing requires npm CLI `11.5.1` or newer, while `--include-attestations` requires at least `11.12.0`; an npm upgrade must update the pin, tests, and release documentation together.

Run the read-only candidate first:

```sh
gh workflow run release.yml --ref main \
  -f version=0.0.1 \
  -f publish=false
```

`--ref main` is a hard gate. Dispatching another branch makes the candidate fail explicitly instead of reporting success with every job skipped. Download and review the candidate assets, complete live acceptance, update only the permitted release-evidence documents, and merge them to `main` before publishing.

## First publication of `0.0.1`

npm allows Trusted Publisher configuration only for a package that **already exists**, so a new package needs a one-time bootstrap. This exception is valid only for `dsh-codex-community@0.0.1` while the package name is absent from the Registry. The workflow checks the version, package-name state, and exact candidate and fails when any condition differs.

1. In the npm website, create a shortest-lived Granular Access Token. Set Packages and scopes to **Read and write**, select **All packages**, and enable **Bypass 2FA**. The token cannot be restricted to a package that does not exist yet, so revoke it immediately after success;
2. paste the token only into the GitHub `npm-release` environment secret `NPM_BOOTSTRAP_TOKEN`. Never put it in the repository, shell history, an Issue, Release evidence, or chat;
3. after the strict gate is ready, dispatch the one-time publication:

   ```sh
   gh workflow run release.yml --ref main \
     -f version=0.0.1 \
     -f publish=true
   ```

4. approve the `npm-release` environment. The workflow injects this secret into `npm publish` only when it must create the absent `0.0.1`, and generates provenance on a GitHub-hosted runner;
5. once the package exists, open its **Settings → Trusted Publisher** and enter: provider `GitHub Actions`, owner `yoshino-xiao7`, repository `dsh-codex`, workflow filename `release.yml`, environment `npm-release`, and allowed action `npm publish`;
6. revoke the npm token and delete the GitHub environment secret:

   ```sh
   gh secret delete NPM_BOOTSTRAP_TOKEN --env npm-release
   ```

7. under **Settings → Publishing access**, select **Require two-factor authentication and disallow tokens**, then verify the Trusted Publisher configuration;
8. the workflow automatically selects Trusted Publisher for every later version. While the package name is absent from the Registry, only `0.0.1` may enter the one-time bootstrap; once the package exists, the workflow does not read the bootstrap secret. If `0.0.1` already exists and is byte-identical to the candidate, a rerun only recovers later Release steps and no longer needs the token.

This bootstrap follows npm's [Trusted Publisher limitation](https://docs.npmjs.com/trusted-publishers/), [2FA and Granular Access Token requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/), and [GitHub Actions provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).

## Routine publication

After Trusted Publisher is configured, every version uses:

```sh
gh workflow run release.yml --ref main \
  -f version=0.0.2 \
  -f publish=true
```

- `publish=false` only builds and verifies a candidate artifact; `publish=true` enables the strict gate, Registry write, and bilingual GitHub Release.
- Routine publication uses GitHub OIDC only and reads no token.
- After npm publication, read back `repository.url`, `dist.integrity`, and provenance, requiring `dist.integrity` to exactly match the candidate `.sri` value.
- Install the exact Registry version in a fresh directory and run `npm audit signatures --json --include-attestations`. A signature or attestation verification failure blocks the public Release; preserve the raw provenance bundle and audit result as Release assets.
- Download the registry tarball and compare it byte-for-byte with the workflow artifact.
- If npm already contains the version, download it first: skip `npm publish` and continue Release recovery only when it is byte-identical, otherwise fail immediately.
- Keep the GitHub Release as a draft while uploading or restoring every asset with `--clobber`. Download every Release asset and compare it byte-for-byte before making the Release public. A rerun of an already-public version succeeds only when the tag commit and every asset still match the candidate.
- Do not tag or publish directly from a development machine.

Any failed gate stops the release, and an immutable npm version is never overwritten. A byte-identical Registry artifact permits safe recovery of later stages; a different artifact requires a fixed, incremented version. If the candidate job succeeded but the publication job failed, rerun only the failed job in the same workflow run, leaving the successful candidate job untouched. Recovery keeps the original `GITHUB_SHA` and the uploaded candidate retained for 90 days even if `main` has advanced, while a new workflow run rebuilds the then-current `main`.
