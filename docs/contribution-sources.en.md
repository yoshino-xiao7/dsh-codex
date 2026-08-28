# Contribution and licensing rules

[简体中文](contribution-sources.md) | [English](contribution-sources.en.md)

These rules keep the code maintainable, behavior verifiable, and origin and licensing auditable.

## Development requirements

- Production code depends only on exported public APIs and does not import unexported internals from DSH, pi-ai, or another dependency.
- Behavioral changes include reproducible tests and update the corresponding Chinese and English documentation.
- Error reports, fixtures, and logs remove tokens, OAuth codes, cookies, credentials, and private conversation content.
- Code, tests, documentation, and media with unclear origin or licensing are not accepted.
- Contributions intentionally submitted for inclusion are provided under the project's Apache-2.0 license; contributors must have the right to submit and grant that license.
- Every new dependency documents its purpose, version, license, runtime permissions, and supply-chain impact.
- Public-interface changes state their compatibility impact and migration path.

## Review checklist

1. Does the change cover only a clearly stated problem or feature?
2. Do tests cover the normal path, failure path, and boundary inputs?
3. Do sign-in, credentials, network, files, and tool side effects retain least privilege?
4. Does every user-visible behavior have complete Chinese and English documentation?
5. Are compatibility, known limitations, and acceptance status accurate?
6. Will new files enter the npm package, and are they required at runtime?

## Repository gates

- `scripts/check-syntax.mjs` checks production-source import boundaries.
- A strict TypeScript consumer checks public declarations.
- Language-pair checks verify counterpart files, required markers, and Markdown structure to catch common one-language-only drift.
- The npm-pack allowlist controls published files.
- Architecture documents record current module boundaries and verification invariants.
- `NOTICE` and `THIRD_PARTY_NOTICES.md` record dependencies, interoperability marks, and license information.

See [CONTRIBUTING.en.md](../CONTRIBUTING.en.md) for the complete submission workflow.
