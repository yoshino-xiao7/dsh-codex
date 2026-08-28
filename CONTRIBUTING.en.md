# Contributing guide

[简体中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Thank you for helping maintain `dsh-codex-community`. Credential safety, protocol accuracy, recoverable failure, and cross-platform maintainability take priority.

## Filing an issue

Include:

- exact plugin, DSH, and Node.js versions;
- operating system and architecture;
- a minimal reproduction, expected result, and actual result;
- a sanitized error code, reset/request ID, or necessary stack;
- whether image history, a tool call, partial output, or a profile override was involved.

Never submit a token, OAuth code, cookie, credential file, complete raw response, private prompt, tool arguments, source image, or unreviewed diagnostic bundle. Follow [SECURITY.md](SECURITY.md) for security issues.

## Development flow

1. Read [Contribution sources and licensing](docs/contribution-sources.en.md) plus the relevant architecture and compatibility documents.
2. Create a clearly named, single-purpose branch from current `main`.
3. Add a failing reproduction first, then the smallest implementation that fixes it.
4. Keep Chinese and English documentation plus the changelog synchronized.
5. Run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run verify:release
```

The complete test suite loads the exact DSH runtime, AgentLoop, and Retry plugin from the frozen fixture. Install that fixture first; tests must not rely on a machine-wide DSH installation.

## Contribution license

Contributions intentionally submitted for inclusion in this repository are provided under the project's Apache-2.0 license unless different terms are stated in writing with the submission and accepted by a maintainer. By submitting, you confirm that you have the right to submit the material and grant that license. This is not a copyright assignment, and no separate CLA is required.

## Pull-request checklist

- [ ] The change is focused and contains no unrelated refactor or formatting churn.
- [ ] Behavior derives from public DSH/pi-ai/OpenAI contracts or reproducible black-box observation.
- [ ] The change is authored by the contributor or derived from clearly identified public interfaces and specifications.
- [ ] I have the right to submit every included item and agree to provide the contribution under Apache-2.0.
- [ ] No code, tests, documentation, or media with unclear origin or licensing are included.
- [ ] New behavior has regression coverage and failures are bounded or fail closed.
- [ ] No secret, account data, real private response, or machine-specific path appears in a fixture.
- [ ] Every dependency explains necessity, size, license, and supply-chain impact.
- [ ] Both languages of README/docs/CHANGELOG are synchronized.
- [ ] `pnpm run check` passes and real-network/platform evidence boundaries are stated.

Merge is not release authorization. Tags, npm publication, GitHub Releases, and community submissions are separate maintainer actions under the release document.
