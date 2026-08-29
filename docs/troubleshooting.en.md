# Troubleshooting

[简体中文](troubleshooting.md) | [English](troubleshooting.en.md)

## `Image request maxPixels must be a positive integer.`

The `0.0.1` bundle explicitly sets `requestImagePixelBudget: 4194304`, and the suite passes a real PNG through the DSH attachment seam. If the error remains:

1. confirm the exact `dsh-codex-community@0.0.1` artifact is running;
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

Whenever the settings page opens or Refresh is clicked manually, the Host requests the real five-hour and weekly usage windows. `/codex-usage` remains a sanitized recent-request observation and provides a safe fallback when the live read is unavailable. A reset from a failure must pass strict format and bounded-horizon checks; otherwise an exhausted observation returns to “unknown” after a bounded interval.

Wait for reset, use another model/plan available to the account, or follow the options shown by the ChatGPT account surface. Never attach account screenshots, tokens, or the complete raw response to an issue.

## The five-hour or weekly limit does not refresh

The settings page reads usage through the Web-backend compatibility endpoint used by the official Codex client. A valid login does not prevent network, authentication, or endpoint-schema changes from making one refresh fail. The page never renders that failure as `0%` remaining and does not erase the latest verified reading. Without a reading to retain, it shows only recent-request observation or “unknown.”

Confirm the sign-in state, then try one manual refresh. If it still fails, check network access to ChatGPT/Codex services and the system clock, then sign in again. A report should contain only plugin and DSH versions, the time of failure, and a sanitized error category—never a token, account ID, request headers, or the raw usage response.

## `QUOTA_OR_RATE_LIMIT`

pi-ai may return only a generalized ChatGPT usage-limit message after discarding the original 429 body/code. The plugin cannot reliably distinguish account quota from transient rate limiting in that case, so it does not label the failure `QUOTA`, update quota observations, or retry automatically when no output exists. If safe plain text already exists, only that partial text is preserved; if a tool call appeared, the stream fails closed. Check the account surface or retry manually later instead of cycling transports.

## Fast is unavailable

First confirm that GPT-5.4, GPT-5.5, GPT-5.6 Luna, Sol, or Terra is selected. The lightning button is unavailable for GPT-5.3 Codex Spark, GPT-5.4 mini, and unknown models; those models never receive the Fast service tier. Click the lightning button to the left of the model selector, or run `/codex status` and `/codex set fast on|off`, to inspect and change the current-session state. The toggle applies to the next request and returns to off after a process restart.

Fast uses the official priority service tier, targets 1.5× speed, and consumes more usage. The plugin does not replay a failed request automatically on a lower tier. After disabling Fast, the user decides whether to send the request again.

## Models or reasoning levels differ from expectations

The settings page shows the installed provider catalog rather than a dynamic account model directory. The reasoning picker uses model-specific subscription-Codex levels and defaults verified by the plugin. It does not show `Default`, `Off`, or `Minimal`. All three GPT-5.6 models expose efforts through `Max`; Codex-client `Ultra` also enables proactive task delegation, and this Provider does not yet implement the matching Harness Agent orchestration, so it does not show an identically named but incomplete mode. Unknown models receive no inferred efforts.

If an older conversation saved `Off` or `Minimal`, click **Repair old reasoning level** beside the composer. The page does not migrate it automatically. The action selects the model's current default and, like a manual model-selector change, also saves that model as the default for future conversations.

Reopen settings, confirm that the target model is enabled, and check the exact installed plugin version. Do not infer capabilities from an old screenshot or model name. If the catalog and selector disagree, report sanitized model IDs and version information without OAuth credentials.

## A response stops halfway

- Visible text already exists and no tool call appeared: whether the failure arrived as a terminal chunk or a direct throw, open text/reasoning blocks are closed, content is saved, and the notice asks you to send “continue.”
- A tool call appeared, including a tool-only stream with no text: the plugin fails closed without replay. The exact error code retains its reliable classification, avoiding repeated file writes, requests, or other tool side effects.
- No output yet: transient `RATE_LIMIT`, `SERVER`, `TIMEOUT`, or `TRANSPORT` failures may retry at most twice.
- Evidence-free `QUOTA_OR_RATE_LIMIT`: no retry without output, safe partial text only when present, and no quota observation.

## Signed in but unavailable

First confirm the sign-in state under **Settings → OpenAI Codex**, ensure the target model is enabled on that same page, and then choose it from the `dsh-codex` provider group in the conversation model selector. A ChatGPT OAuth bearer is not an OpenAI Platform API key. If refresh fails, sign out on that settings page and sign in again. Removing the package does not automatically erase the grant.
