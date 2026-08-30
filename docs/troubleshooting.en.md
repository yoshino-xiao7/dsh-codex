# Troubleshooting

[简体中文](troubleshooting.md) | [English](troubleshooting.en.md)

## `Image request maxPixels must be a positive integer.`

The current implementation explicitly sets `requestImagePixelBudget: 4194304`, and the suite passes a real PNG through the DSH attachment seam. If the error remains:

1. confirm that the exact installed artifact is running. `1.0.0` is unpublished and the current stable version remains `dsh-codex-community@0.0.4`; do not mix files from another version into the same profile;
2. confirm that the profile's `dsh-codex` configuration contains all three image budgets;
3. check settings for zero, negative, fractional, or another explicitly invalid image field; omitted and `null` values receive safe defaults;
4. run `npm test -- --test-name-pattern=maxPixels` or the complete `pnpm test`;
5. report only plugin, DSH, and Node versions plus a sanitized stack—never the source image or credentials.

If another bundle or user setting replaces the complete `dsh-codex` config row, merge back all three valid positive-integer budgets instead of retaining only one.

## `AccountQuotaExceeded` / five-hour quota

This is an exhausted account usage window, not a transient request-rate limit. The plugin:

- maps it to `QUOTA` and stops automatic retry;
- displays the provider reset time and request ID only when they are format-valid and come from the failure's top level or the same independently quota-confirming `error` envelope;
- preserves already visible safe text when possible;
- does not claim that another transport or repeated requests can bypass account quota.

Whenever settings opens, the page becomes visible again, a window reaches its reset boundary, or Refresh is clicked manually, the Host requests the real five-hour and weekly usage windows. Crossing the weekly under-24-hour threshold only changes local display and performs no extra network read. `/codex-usage refresh` actively uses the same reader for account windows, while `/codex-usage status` reads only sanitized recent-request `QuotaObserver` state as the safe fallback when a live read is unavailable. A reset from a failure must pass strict format and bounded-horizon checks; otherwise an exhausted observation returns to “unknown” after a bounded interval.

Wait for reset, use another model/plan available to the account, or follow the options shown by the ChatGPT account surface. Never attach account screenshots, tokens, or the complete raw response to an issue.

## The five-hour or weekly limit does not refresh

The settings page reads usage through the Web-backend compatibility endpoint used by the official Codex client. A valid login does not prevent network, authentication, or endpoint-schema changes from making one refresh fail. The page never renders that failure as `0%` remaining and does not erase the latest verified reading. Without a reading to retain, it shows only recent-request observation or “unknown.”

Confirm the sign-in state, then try one manual refresh or run `/codex-usage refresh`. If it still fails, check network access to ChatGPT/Codex services and the system clock, then sign in again. Account diagnostics classify HTTP failures into fixed 401/403 authentication, 429 rate-limit, 5xx server, or other HTTP categories without displaying raw responses. A report should contain only plugin and DSH versions, the time of failure, and that sanitized category—never a token, account ID, request headers, or the raw usage response.

## `QUOTA_OR_RATE_LIMIT`

pi-ai may return only a generalized ChatGPT usage-limit message after discarding the original 429 body/code. The plugin cannot reliably distinguish account quota from transient rate limiting in that case, so it does not label the failure `QUOTA`, update quota observations, or retry automatically when no output exists. If safe plain text already exists, only that partial text is preserved; if a tool call appeared, the stream fails closed. Check the account surface or retry manually later instead of cycling transports.

## Fast is unavailable

First confirm that GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, or Terra is selected. The lightning button is unavailable for GPT-5.3 Codex Spark, GPT-5.4 mini, and unknown models; those models never receive the Fast service tier. Click the lightning button to the left of the model selector, or run `/codex status` and `/codex set fast on|off`, to inspect and change the current-session state. The toggle applies to the next request and returns to off after a process restart.

Fast uses the official priority service tier, targets 1.5× speed, and consumes more usage. The plugin does not replay a failed request automatically on a lower tier. After disabling Fast, the user decides whether to send the request again.

## Using connection diagnostics

Open **Settings → OpenAI Codex → Connection diagnostics**. The section is collapsed by default and never runs automatically:

- **Check this device** reads only the local route, model catalog, enabled count, and credential metadata. It performs no network access or OAuth refresh and sends no model request.
- **Check account** reads usage once after the local checks. It may refresh OAuth under the existing credential contract when needed, but it sends no model request and consumes no model usage.

Diagnostics show only fixed checks, status codes, and bounded facts. They never display tokens, account IDs, raw responses, or raw errors. Account reads distinguish 401/403 authentication, 429 rate-limit, 5xx server, and other HTTP failures. **Copy diagnostics report** copies the same validated safe projection and never rereads a raw exception. Diagnostics can separate local configuration problems from account-usage-read problems, but they do not prove that live text, image, tool, Fast, or a selected Transport request works; those still require a user-initiated request.

## Models or reasoning levels differ from expectations

The settings page shows the installed provider catalog rather than a dynamic account model directory. Base fields come from Harness's generic discovery API; input modalities, selectable Low-through-Max reasoning efforts actually exposed by the current catalog, and Fast badges come from an independent local loopback-only read-only capability RPC. If that RPC is unavailable, the base catalog remains visible and unproven badges are omitted. The plugin neither invents nor labels a default effort that the catalog does not provide; when no effort is explicit, the current Provider or service applies its default behavior. The picker does not show `Default`, `Off`, or `Minimal`. All three GPT-5.6 models expose efforts through `Max`; Codex-client `Ultra` also enables proactive task delegation, and this Provider does not yet implement the matching Harness Agent orchestration, so it does not show an identically named but incomplete mode. Unknown models receive no inferred reasoning or Fast support.

If an older conversation saved `Off` or `Minimal`, click **Repair old reasoning level** beside the composer. The page does not migrate it automatically. The action removes the unsupported explicit effort, after which the current Provider or service applies its default behavior. Repair neither displays, writes, nor claims a concrete default effort that the catalog does not provide. It still follows the model selector's model-persistence semantics and saves the current model as the default model for future conversations.

Reopen settings, confirm that the target model is enabled, and check the exact installed plugin version. Do not infer capabilities from an old screenshot or model name. If the catalog and selector disagree, report sanitized model IDs and version information without OAuth credentials.

## A response stops halfway

- Visible text already exists and no tool call appeared: whether the failure arrived as a terminal chunk or a direct throw, open text/reasoning blocks are closed, content is saved, and the notice asks you to send “continue.”
- A tool call appeared, including a tool-only stream with no text: the plugin fails closed without replay. The exact error code retains its reliable classification, avoiding repeated file writes, requests, or other tool side effects.
- No output yet: transient `RATE_LIMIT`, `SERVER`, `TIMEOUT`, or `TRANSPORT` failures may retry at most twice.
- Evidence-free `QUOTA_OR_RATE_LIMIT`: no retry without output, safe partial text only when present, and no quota observation.

## Signed in but unavailable

First confirm the sign-in state under **Settings → OpenAI Codex**, ensure the target model is enabled on that same page, and then choose it from the `dsh-codex` provider group in the conversation model selector. A ChatGPT OAuth bearer is not an OpenAI Platform API key. If refresh fails, sign out on that settings page and sign in again. Removing the package does not automatically erase the grant.
