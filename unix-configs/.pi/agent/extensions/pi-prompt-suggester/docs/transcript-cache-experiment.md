# Transcript-cache suggester experiment

## Goal

Add a **parallel** suggestion path that uses the real `pi` session transcript as the primary context while preserving the current compact-summary suggester as the control.

The experiment is designed to answer two questions:

1. Does using the real branch transcript improve next-prompt suggestion quality?
2. Can we do that without materially increasing cost because the request mostly reuses a cached prompt prefix?

## Why this exists

The current suggester sends a standalone compact prompt made from:

- the latest assistant turn
- recent user prompts
- tool signals / touched files
- unresolved questions
- project seed summaries
- recent changed-course examples

That control path is cheap and simple, but it does **not** send the real branch transcript to the model. The experiment adds a second path that does.

## Variant model

The control path remains available.

- `compact` — current summary-based suggester
- `transcript-cache` — experimental transcript-based suggester

Variants can choose between these modes without replacing the default behavior for everyone.

## Request shape

The transcript-cache request is intentionally shaped for prompt caching.

### Shared prefix

The experiment reuses:

- the **real effective system prompt** from `ctx.getSystemPrompt()`
- the **real branch transcript** reconstructed from `ctx.sessionManager.getBranch()`

This is the prefix we want to match the next real user turn as closely as possible.

### Divergent suffix

The experimental suggester appends one extra **user** message that says, in effect:

- predict the next user message only
- do not continue as the assistant
- return exactly `[no suggestion]` when confidence is low
- keep the result short

Any compact seed guidance or recent changed-course examples also live in this suffix so the shared conversation prefix stays clean.

### Why the suffix is a user message

Appending the experimental instruction as a final user message means the request diverges **after** the shared conversation prefix. That gives the next real user turn the best chance of reusing the same cached prefix.

## Guardrails

The experiment should fall back to `compact` when any of the following are true:

- no active `ExtensionContext` is available
- no active model is available
- context usage is already near the model limit
- the branch transcript is unexpectedly huge
- transcript reconstruction fails
- the model request fails in a way that would otherwise break the UX

This keeps the rollout safe and prevents worst-case cost explosions.

## Instrumentation

Every suggestion run should log enough metadata to compare control vs experiment:

- variant name
- suggestion mode / strategy
- prompt/input/output/cache-read/cache-write usage
- latency
- suggestion length
- no-suggestion vs suggestion
- steering outcome on the next user turn (`accepted_exact`, `accepted_edited`, `changed_course`)

For transcript-cache runs we also want to observe the **next real user turn** and record the assistant response usage for that turn, so we can see whether cache reuse remained strong after the suggestion request.

## Evaluation stance

This extension can measure strong quality proxies, but it cannot be the final judge of UX quality by itself.

Good automated signals:

- steering classification
- semantic closeness to the next user prompt
- no-suggestion rate
- cost / cache-read behavior

Human review is still needed for final promotion decisions.

## Promotion criteria

The experiment should only become the default if all of the following hold:

- suggestion quality improves materially
- extra cost stays acceptable
- latency stays acceptable
- next-turn cache reuse remains strong within the provider cache window

## Non-goals

- Replacing the control path immediately
- Running autonomous live A/B tests without operator review
- Depending on provider-specific "conversation fork" APIs

The design relies on **stable shared prompt prefixes**, not fork metadata.
