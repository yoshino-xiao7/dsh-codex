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

The “Codex quota observation” card and `/codex-usage` show only state produced by recent requests. They do not query the account proactively or represent a live balance. A reset must pass strict format and bounded-horizon checks; otherwise an exhausted observation returns to “unknown” after a bounded interval.

Wait for reset, use another model/plan available to the account, or follow the options shown by the ChatGPT account surface. Never attach account screenshots, tokens, or the complete raw response to an issue.

## `QUOTA_OR_RATE_LIMIT`

pi-ai may return only a generalized ChatGPT usage-limit message after discarding the original 429 body/code. The plugin cannot reliably distinguish account quota from transient rate limiting in that case, so it does not label the failure `QUOTA`, update quota observations, or retry automatically when no output exists. If safe plain text already exists, only that partial text is preserved; if a tool call appeared, the stream fails closed. Check the account surface or retry manually later instead of cycling transports.

## Fast is unavailable

Run `/codex status` to confirm whether Fast is enabled for the current session. Fast requests the priority service tier, whose availability depends on the account and service. The plugin does not replay a failed request automatically on a lower tier. Run `/codex set fast off` to disable Fast for this session, then decide whether to send the request again.

## A response stops halfway

- Visible text already exists and no tool call appeared: whether the failure arrived as a terminal chunk or a direct throw, open text/reasoning blocks are closed, content is saved, and the notice asks you to send “continue.”
- A tool call appeared, including a tool-only stream with no text: the plugin fails closed without replay. The exact error code retains its reliable classification, avoiding repeated file writes, requests, or other tool side effects.
- No output yet: transient `RATE_LIMIT`, `SERVER`, `TIMEOUT`, or `TRANSPORT` failures may retry at most twice.
- Evidence-free `QUOTA_OR_RATE_LIMIT`: no retry without output, safe partial text only when present, and no quota observation.

## Signed in but unavailable

First confirm the sign-in state under **Settings → Codex sign-in**, ensure the target model is enabled on that same page, and then choose it from the `dsh-codex` provider group in the conversation model selector. A ChatGPT OAuth bearer is not an OpenAI Platform API key. If refresh fails, sign out on the Codex sign-in page and sign in again. Removing the package does not automatically erase the grant.
