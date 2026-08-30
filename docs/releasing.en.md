# Release process

[简体中文](releasing.md) | [English](releasing.en.md)

Versioning begins at `0.0.1`. The `0.0.x` line is a technical preview, but `0.0.1` is still published under npm `latest` with a full GitHub Release. Every Release requires complete Chinese and English copy. The pre-publication hard gates are `3/3` platforms, complete supply-chain evidence, and maintainer approval; controlled-account validation may start at `0/13`, continue after formal publication, and must remain honestly disclosed.

## Preparation

1. Create a clearly named release branch from `main`;
2. update `package.json`, `CHANGELOG.md`, the README feature and support-boundary statements, compatibility date, and `docs/releases/v<version>.md`;
3. confirm package name, repository URL, license, peer range, and `dsh.bundle`;
4. review and update both the root `pnpm-lock.yaml` and `test/fixtures/dsh-runtime/pnpm-lock.yaml`; never update only one dependency graph;
5. require green Linux, macOS, and Windows CI before merge;
6. state the controlled-account validation plan and current progress. `0.0.1` may be formally published at `0/13`, then completed check by check with a controlled test account without recording tokens, OAuth codes, cookies, or account credentials.

Use the offline preparation script to establish the next release skeleton (replace `X.Y.Z` with the target version):

```sh
pnpm run release:prepare -- X.Y.Z
```

It only creates or completes the `package.json` version, bilingual `CHANGELOG.md` draft, bilingual Release draft, and a fresh schema v3 draft acceptance record. The script is idempotent, accesses neither Git nor the network, and never fabricates dates, commits, or passing evidence. Existing valid human-authored content is preserved, and any conflict fails before writing. The README, compatibility documents, lockfiles, release branch, commit, and tag still require manual handling.

### Replaying a candidate locally or in CI

From a committed candidate checkout with a clean working tree, use Node 24, pnpm `10.34.5`, and npm `11.16.0` to replay the candidate declared in the current `package.json`:

```sh
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
pnpm run release:candidate -- "$PACKAGE_VERSION"
```

The command runs on a local development machine or in separate CI. It neither publishes an npm package or GitHub Release nor reads npm tokens, OIDC, OAuth, or other credentials. It performs the root and frozen-DSH-fixture frozen installs, the complete `check`, exactly one artifact-producing `npm pack`, a local-tarball publish dry-run, the deterministic SBOM, exact-candidate DSH profile smoke, isolated installation and Host import, and the production-dependency audit. It writes the candidate package, digests, and all evidence under `release/`. To prevent stale files from being mistaken for current evidence, any existing candidate output makes the command fail before its first write; remove or move only old output that you have confirmed is no longer needed before retrying.

Regular CI's separate read-only `candidate-replay` job uses a clean Ubuntu/Node 24 checkout, pinned pnpm `10.34.5`, and npm `11.16.0`. It reads the version dynamically from `package.json`, invokes the unified command exactly once, and uploads the complete `release/` directory as the `dsh-codex-community-${{ github.sha }}-ci-replay` artifact with 14-day retention.

This is only a reproducible local/CI preflight. The authoritative release candidate must still be generated and uploaded by the `release.yml` workflow on `main`. A local replay on macOS or Windows cannot replace that workflow's Linux x64 publication evidence, three-platform CI/profile smoke, the supply-chain gate, or maintainer approval. It also does not perform post-release controlled-account validation.

## Two gate levels

Regular CI uses draft mode. It permits `TBD` and `pending`, while checking the version, bilingual Release structure, and acceptance-record shape so unreleased work remains continuously testable:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run verify:release
```

`npm publish` uses strict mode. `0.0.1` may retain controlled-account validation at `0/13`, so `pending` and its corresponding `TBD` fields are valid, truthful states inside live records. Publication fails before any network write if any of these publication conditions is unmet:

- the Release date, Accepted commit, current-version CHANGELOG date, or another publication-critical field is still a placeholder;
- `docs/releases/v<version>.acceptance.json` does not record maintainer approval for formal publication;
- Linux, macOS, and Windows CI/profile smoke have not all passed with `3/3` evidence bound to the same candidate commit;
- platform timestamps, runner details, Node versions, approver, or HTTPS evidence links are missing;
- files outside the permitted release-evidence set changed after the accepted commit; only the bilingual Release body, acceptance JSON, bilingual READMEs, `CHANGELOG.md`, and bilingual compatibility documents may be updated to clear publication state;
- the `.tgz`, SHA-256, SRI, locked reference SBOM, actual install trees, production-dependency audit, or isolated-import evidence is missing or inconsistent.

Both the release workflow and `prepublishOnly` invoke the strict command. With `publish=true`, the candidate job first binds the candidate package, isolated-import evidence, and current release commit to strict verification; the protected environment is not requested until that verification passes. After approval, the publication job downloads the same immutable candidate and repeats the identical verification. To reproduce that invocation from the repository root, use:

```sh
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
RELEASE_PACKAGE_FILE="release/dsh-codex-community-${PACKAGE_VERSION}.tgz" \
RELEASE_ISOLATED_IMPORT_EVIDENCE=release/isolated-import.json \
RELEASE_SOURCE_COMMIT="$(git rev-parse HEAD)" \
pnpm run verify:release:publish
# After Registry publication and provenance/signature readback, upload immutable Registry evidence; the GitHub Release job has no OIDC and downloads and rechecks that evidence before writing the Release
```

Do not bypass the gate with fabricated environment variables. Keep the release in draft state until all three platform, supply-chain, and maintainer-approval records exist. Missing live evidence remains `pending` and must never be presented as verified.
`prepublishOnly` protects publication from a repository checkout. npm does not run that lifecycle when publishing an existing tarball, so the workflow runs the strict gate once before approval and again immediately before publishing that same `.tgz`; it requests a short-lived OIDC identity token only after the protected environment approves the job.

## Acceptance record

1. Run cross-platform CI/profile smoke and complete supply-chain verification against a committed release candidate.
2. Let the first `pass-platform` bind that candidate's full 40-character commit to `testedCommit`.
3. Run the profile smoke on all three operating systems with exact DSH `0.1.1-rc.2` and a tested Node 22 release (at least `22.19.0`) or Node 24. After a maintainer verifies the evidence, use `pass-platform` to record `testedAt`, environment details, and HTTPS evidence links without sensitive parameters.
4. After all three platforms, the supply-chain evidence, and the candidate boundary pass, a maintainer records approval and changes `releaseStatus` to `approved`. This approves formal publication; it does not claim that controlled-account validation is `13/13`.
5. `0.0.1` may retain live validation at `0/13` and be published under npm `latest` with a full GitHub Release. The Release and compatibility documents must disclose every unverified check honestly.
6. After publication, manually complete the live checks below with a test account in a controlled local environment. This consumes account quota. Mark a check `passed` only after every fixed assertion has sanitized evidence; a free-form scope statement is not a substitute.
7. Before publication, any source, configuration, dependency, lockfile, or workflow change after the candidate was bound requires resetting the draft record to the new commit and repeating CI, profile smoke, and supply-chain verification; an approved record cannot be reset. Product findings after formal publication go to the next unpublished increment; never overwrite an existing version.

| Check | Required proof | Copyable exact `--assert` arguments |
| --- | --- | --- |
| `oauthWebSignIn` | OAuth starts from DSH Settings, the credential becomes configured, and a post-sign-in request succeeds | `--assert=flowStartedFromSettings --assert=credentialConfigured --assert=postSignInRequestSucceeded` |
| `modelCatalog` | Settings shows the catalog and the conversation model selector can select a Codex model | `--assert=settingsCatalogVisible --assert=conversationModelSelectable` |
| `textStream` | A non-empty text delta and a normal terminal event are observed | `--assert=nonEmptyTextDelta --assert=terminalStopObserved` |
| `reasoningStream` | A reasoning block is observed and the request terminates normally | `--assert=reasoningBlockObserved --assert=terminalStopObserved` |
| `terminalUsage` | Terminal usage contains both input and output token counts | `--assert=inputTokensObserved --assert=outputTokensObserved` |
| `toolRoundTrip` | A safe test tool is requested, executed, returned, and followed by a successful response | `--assert=toolCallObserved --assert=toolExecuted --assert=toolResultReturned --assert=followUpSucceeded` |
| `replayContinuity` | Two turns succeed and the second correctly uses first-turn context | `--assert=firstTurnSucceeded --assert=secondTurnUsedPriorContext --assert=secondTurnSucceeded` |
| `imageMaxPixels` | Native image input succeeds and the request projects `maxPixels=4194304` | `--assert=nativeImageAccepted --assert=maxPixels4194304Projected --assert=requestSucceeded` |
| `transportAuto` | At least one live request succeeds through the auto transport | `--assert=requestSucceeded` |
| `transportSse` | At least one live request succeeds through the SSE transport | `--assert=requestSucceeded` |
| `transportWebsocket` | At least one live request succeeds through the WebSocket transport | `--assert=requestSucceeded` |
| `transportWebsocketCached` | Two consecutive turns succeed in the same session | `--assert=firstTurnSucceeded --assert=secondTurnSucceeded` |
| `fastPriority` | Priority is requested, the live request succeeds, and no automatic downgrade replay occurs | `--assert=priorityRequested --assert=requestSucceeded --assert=noAutomaticDowngrade` |

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

### Cross-platform CI/profile-smoke recording

After a maintainer verifies the CI and profile-smoke evidence for a platform, record the result with this offline command:

```sh
pnpm run release:acceptance -- pass-platform <linux|macos|windows> \
  --tested-commit=<full-40-character-lowercase-SHA> \
  --tested-at=<RFC3339-with-timezone> \
  --runner=<single-line-runner-id> \
  --node-version=<22.x.y-or-24.x.y> \
  --dsh-version=0.1.1-rc.2 \
  --profile-smoke=passed \
  --evidence-url=<sanitized-HTTPS>
```

All seven options are required exactly once and must use the `--name=value` form. `--runner` must be a trimmed, non-placeholder, single-line identifier of at most 128 characters with no control characters. `--node-version` accepts a stable three-part Node 22 release (at least `22.19.0`) or Node 24, optionally prefixed with `v`. `--dsh-version` and `--profile-smoke` must be exactly `0.1.1-rc.2` and `passed`, respectively. `--evidence-url` must be an absolute HTTPS URL without userinfo, query data, or a fragment.

`pass-platform` only writes a CI/profile-smoke result that a maintainer has already verified to the acceptance record; it does not run the smoke, access the network, or check that the commit exists. The first `pass-platform` or `pass` binds the full candidate SHA, and all later platform and live-network evidence must use that same SHA. A passed item permits only a semantically identical idempotent replay; any differing field conflicts and cannot overwrite existing evidence. The same identical-replay-only rule applies after approval.

### Post-release local controlled-account validation

A maintainer must perform real-account operations manually in a controlled local environment. For `0.0.1`, these checks run after formal publication and incomplete items remain `pending`. `release:acceptance` is only an offline evidence recorder: it does not access the network, read credentials, make provider requests, infer assertions, or replace human judgment.

Inspect the current state first:

```sh
pnpm run release:acceptance -- status
```

`status` displays only passed/pending counts and check names; it never displays evidence values. After manually completing one check and reviewing its sanitized evidence, repeat `--assert` to explicitly list every fixed assertion required by that check:

```sh
pnpm run release:acceptance -- pass <check> \
  --tested-commit=<full-40-character-lowercase-SHA> \
  --tested-at=<RFC3339> \
  --evidence-url=<sanitized-HTTPS> \
  --assert=<fixed-assertion> \
  --assert=<fixed-assertion>
```

The first `pass-platform` binds the candidate while the record's `testedCommit` is still `TBD`. Every later `pass-platform`, `pass`, and `approve` must provide the same full 40-character lowercase SHA, preventing platform and live-network evidence from different candidates from being mixed. `pass` records `passed` only when the assertion names are complete and exactly match the fixed table above; it never infers, fills, or passes assertions automatically. Live validation may continue from `pending` to `passed` after a maintainer approves and publishes `0.0.1`. Record publication approval once all three platform and supply-chain records are complete:

```sh
pnpm run release:acceptance -- approve \
  --tested-commit=<full-40-character-lowercase-SHA> \
  --approved-by=<public-maintainer-id> \
  --approved-at=<RFC3339> \
  --evidence-url=<sanitized-HTTPS>
```

The command checks only the SHA format and its consistency with the acceptance record, and records a human approval that has already been made; it does not approve on a maintainer's behalf. The strict publish gate still verifies that the commit exists and that the candidate is an ancestor of the release commit. Tokens, OAuth codes, cookies, account identifiers, and complete private content must never appear in arguments, evidence URLs, acceptance records, or terminal logs.

### Resetting the candidate commit

When source or other accepted content changes after a draft candidate has been bound, replace the old candidate with the new commit first:

```sh
pnpm run release:acceptance -- reset-candidate \
  --from-commit=<old-full-40-character-lowercase-SHA> \
  --to-commit=<new-full-40-character-lowercase-SHA>
```

Both SHAs must be full, lowercase, and different; a normal reset requires the current `testedCommit` to match `--from-commit`. `reset-candidate` accepts only a draft record. It clears every old platform result, live-network result, and approval field, restores all platform/live state to `pending`/`TBD`/`false`, and binds `testedCommit` to `--to-commit`. An approved record cannot be reset.

The command runs offline, accesses neither the network nor Git, and does not check whether either commit exists. Managed-path boundary checks, a concurrent-write lock, and atomic replacement protect the acceptance file. Replaying the same `old → new` command returns `unchanged` when the record is already a fresh draft with only the new SHA bound; any residual platform, live, or approval evidence instead conflicts and produces no write. After the reset, run cross-platform CI/profile smoke against the new SHA first, then record the new evidence with `pass-platform`; every later platform, live, and approval command must continue to use that new SHA.

Before publication, fill in the Release date and accepted commit from `testedCommit`, then remove every placeholder. The workflow records the exact release commit used to build the artifact in the isolated-import evidence and uploads it as an asset.

## Artifact gate

The release workflow runs these stages in order:

```sh
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
PACKAGE_FILE="release/dsh-codex-community-${PACKAGE_VERSION}.tgz"
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run verify:release
mkdir -p release
npm install --global --ignore-scripts --no-audit --no-fund npm@11.16.0
npm --version > release/npm-cli-version.txt
npm pack --ignore-scripts --json --pack-destination release > release/pack.json
# Dry-run the local tarball through ./$PACKAGE_FILE, then generate SHA-256, SRI, and the locked reference SBOM
npm publish "./$PACKAGE_FILE" --dry-run --force --ignore-scripts --json
DSH_CLI_ROOT="$PWD/test/fixtures/dsh-runtime" DSH_PLUGIN_PACKAGE="$PACKAGE_FILE" pnpm run smoke:dsh-profile
# Record the DSH environment, actual install trees, production-dependency audit, and isolated-import evidence, then upload the immutable candidate and write an approval summary with both SHA-256 values and its download link
# With publish=true, run this strict gate in the candidate job first; only then request environment approval, after which the publish job downloads the same candidate and repeats it:
npm install --global --ignore-scripts --no-audit --no-fund npm@11.16.0
pnpm install --frozen-lockfile --ignore-scripts
RELEASE_PACKAGE_FILE="$PACKAGE_FILE" \
RELEASE_ISOLATED_IMPORT_EVIDENCE=release/isolated-import.json \
RELEASE_SOURCE_COMMIT="$(git rev-parse HEAD)" \
pnpm run verify:release:publish
```

Build the `.tgz` exactly once, then generate SHA-256, SRI, and a CycloneDX SBOM. The SRI must exactly equal the npm Registry `dist.integrity` readback; comparing only an algorithm prefix or a reformatted value is insufficient.

The CycloneDX SBOM is a **locked reference dependency graph** generated offline from the committed `pnpm-lock.yaml` and package manifest. It proves what the candidate source declares and locks; it does not claim to be the complete tree produced by a particular installation. The generator runs only `pnpm list --prod --json --depth Infinity --lockfile-only`; it never runs `npm install`, `npm sbom`, or re-resolves dependencies from the Registry. The output is deduplicated and stably sorted, omits local absolute paths and download URLs, binds the tarball SHA-256, lockfile SHA-256, and package dependency-descriptor SHA-256, and verifies that the artifact's package name, version, license, repository, and production/peer dependency descriptors match the repository manifest.

The root `pnpm-lock.yaml` locks the plugin's build and release dependencies. `test/fixtures/dsh-runtime/pnpm-lock.yaml` separately locks the complete DSH runtime and peer graph used by compatibility smoke. CI, compatibility monitoring, and release candidates all run `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts`; they never resolve an unbounded peer graph at runtime through `npm install @deepseek-ai/dsh@...`. Direct npm resolution can consume uncontrolled memory and can produce a different runtime for identical source as Registry state changes.

That same artifact is then installed into an isolated profile by the fixture's exact `0.1.1-rc.2` DSH runtime for a Web startup smoke, and it is also installed with `--ignore-scripts` in an empty directory and imported as a Host plugin. The two actual installations are recorded separately as `dsh-runtime-dependency-tree.json` and `isolated-dependency-tree.json`, alongside the reference SBOM. Only after the Web/profile smoke passes does the workflow generate `dsh-runtime-environment.json`, recording the DSH version, fixture-lock SHA-256, complete Node version, pnpm version, platform, architecture, and disabled-lifecycle-script state; the strict gate recomputes and verifies those values from the release commit. The isolated install also runs `npm audit --omit=dev --audit-level=high --json` and saves `npm-audit.json`; any high or critical production-dependency vulnerability blocks publication. The candidate job has only `contents: read`, and its artifact plus evidence are retained for 90 days. Its approval summary shows the version, source commit, package SHA-256, Actions archive SHA-256, acceptance progress, and candidate download link. Only `publish=true`, `refs/heads/main`, and a passing pre-approval strict gate can request approval from the protected `npm-release` environment. The Registry job has only `contents: read` and `id-token: write`; after npm publication, byte-for-byte readback, signature checks, and provenance binding to the package digest, repository, `release.yml`, `main`, and source commit, it uploads immutable Registry evidence. The following GitHub Release job has only `contents: write` and no OIDC; it downloads and rechecks that evidence before writing the Release. After the Release becomes public, the workflow rechecks its bilingual body, title, tag, exact asset set, and every asset byte before confirming the tag commit.

Because the frozen fixture uses `--ignore-scripts`, this layer proves DSH Web/profile compatibility with this plugin; it does not claim to validate native terminal or native-build capabilities in DSH dependencies that require lifecycle scripts.

An upgrade to DSH, pi-ai, or another runtime dependency must update and review both lockfiles, confirm that the fixture still pins only the intended DSH version, repeat complete cross-platform CI, profile smoke, and supply-chain verification before publication, and restart controlled live validation afterward. A scheduled Registry drift report does not replace this upgrade process.

## Release environment

Create `npm-release` under **GitHub repository Settings → Environments**:

1. configure at least one required reviewer;
2. restrict deployment branches to `main`;
3. do not add a normal repository-level npm token; only during the first-publish bootstrap, temporarily add the environment secret `NPM_BOOTSTRAP_TOKEN`;
4. have the releaser manually dispatch the workflow; approve the environment only after the candidate job's pre-approval strict gate passes and its summary confirms the version, source commit, both SHA-256 values, acceptance progress, and immutable candidate download.

The release workflow pins npm `11.16.0` and verifies and records that exact version before any network write. Trusted Publishing requires npm CLI `11.5.1` or newer, while `--include-attestations` requires at least `11.12.0`; an npm upgrade must update the pin, tests, and release documentation together.

Run the read-only candidate first:

```sh
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
gh workflow run release.yml --ref main \
  -f version="$PACKAGE_VERSION" \
  -f publish=false
```

`--ref main` is a hard gate. Dispatching another branch makes the candidate fail explicitly instead of reporting success with every job skipped. Download and review the candidate assets, confirm `3/3` platforms, complete supply-chain evidence, and maintainer approval, then update only the permitted release-evidence documents and merge them to `main` before publishing. Controlled-account acceptance progress does not block a formal release whose hard gates have passed, but it must remain honestly disclosed.

## First publication of `0.0.1`

npm allows Trusted Publisher configuration only for a package that **already exists**, so a new package needs a one-time bootstrap. This exception is valid only for `dsh-codex-community@0.0.1` while the package name is absent from the Registry. The workflow checks the version, package-name state, and exact candidate and fails when any condition differs.

1. In the npm website, create a shortest-lived Granular Access Token. Set Packages and scopes to **Read and write**, select **All packages**, and enable **Bypass 2FA**. The token cannot be restricted to a package that does not exist yet, so revoke it immediately after success;
2. paste the token only into the GitHub `npm-release` environment secret `NPM_BOOTSTRAP_TOKEN`. Never put it in the repository, shell history, an Issue, Release evidence, or chat;
3. after the platform, supply-chain, and maintainer-approval gates pass, dispatch the one-time formal publication; the workflow uses npm `latest` and creates a full GitHub Release:

   ```sh
   gh workflow run release.yml --ref main \
     -f version=0.0.1 \
     -f publish=true
   ```

4. approve the `npm-release` environment. The workflow injects this secret into `npm publish` only when it must create the absent `0.0.1`, and generates provenance on a GitHub-hosted runner;
5. once the package exists, open its **Settings → Trusted Publisher** and enter: Provider `GitHub Actions`, Organization or user `yoshino-xiao7`, Repository `dsh-codex`, Workflow filename `release.yml`, Environment name `npm-release`, and select only `npm publish` under Allowed actions;
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
  -f version=X.Y.Z \
  -f publish=true
```

Replace `X.Y.Z` with the unpublished target version.

- `publish=false` only builds and verifies a candidate artifact; `publish=true` enables the strict gate, Registry write, and bilingual GitHub Release.
- `0.0.1` publishes under npm `latest` with a full GitHub Release. Controlled-account progress may be `0/13`, but the documentation must disclose that status exactly.
- Routine publication uses GitHub OIDC only and reads no token.
- After npm publication, read back `repository.url`, `dist.integrity`, and provenance, requiring `dist.integrity` to exactly match the candidate `.sri` value.
- Install the exact Registry version in a fresh directory and run `npm audit signatures --json --include-attestations`. A signature or attestation verification failure blocks the public Release; preserve the raw provenance bundle and audit result as Release assets.
- Download the registry tarball and compare it byte-for-byte with the workflow artifact.
- If npm already contains the version, download it first: skip `npm publish` and continue Release recovery only when it is byte-identical, otherwise fail immediately.
- Keep the GitHub Release as a draft while uploading or restoring every asset with `--clobber`. Download every Release asset and compare it byte-for-byte before making the Release public. A rerun of an already-public version succeeds only when the tag commit and every asset still match the candidate.
- Do not tag or publish directly from a development machine.

Continue collecting controlled-account evidence against the formal release. If validation finds a product issue, fix it in the next unpublished incremented version; never modify, overwrite, or republish an existing version.

Any failed gate stops the release, and an immutable npm version is never overwritten. A byte-identical Registry artifact permits safe recovery of later stages; a different artifact requires a fixed, incremented version. If the candidate job succeeded but the publication job failed, rerun only the failed job in the same workflow run, leaving the successful candidate job untouched. Recovery keeps the original `GITHUB_SHA` and the uploaded candidate retained for 90 days even if `main` has advanced, while a new workflow run rebuilds the then-current `main`.
