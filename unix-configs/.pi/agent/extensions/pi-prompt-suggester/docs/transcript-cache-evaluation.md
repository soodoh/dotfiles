# Transcript-cache experiment evaluation criteria

Use this checklist before promoting `transcript-cache` over `compact`.

## Must-have metrics

Review persistent suggester logs and compare the control and experiment on:

- `suggestion.generated`
- `suggestion.none`
- `steering.recorded`
- `suggestion.next_turn.cache_observed`

Key fields to compare:

- `variantName`
- `requestedStrategy`
- `strategy`
- `fallbackReason`
- `sampledOut`
- `latencyMs`
- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `cost`

## Go / no-go rules

Promote the transcript-cache strategy only when all of the following are true over a meaningful sample:

1. **Quality improves materially**
   - higher `accepted_exact + accepted_edited` rate, or
   - lower `changed_course` rate, or
   - clearly better human-reviewed suggestion quality.

2. **Cost remains acceptable**
   - added suggester cost is small relative to the control, and
   - cache misses are rare enough that the experiment does not create surprising spikes.

3. **Latency remains acceptable**
   - median and tail latency stay within an acceptable interactive budget.

4. **Next-turn cache reuse stays strong**
   - `suggestion.next_turn.cache_observed.cacheReadTokens` remains strong on the assistant turn that follows a shown suggestion.

5. **Fallback behavior stays safe**
   - transcript runs that exceed guardrails fall back cleanly to `compact`, and
   - fallback rates are understandable and not dominated by implementation bugs.

## Recommended review process

- Start with `compact` as control and a named `transcript-cache` variant.
- Review logs for at least dozens of real turns.
- Spot-check a smaller human-reviewed sample of contexts and suggestions.
- Only then decide whether to:
  - keep the strategy experimental,
  - widen rollout,
  - or switch the default.
