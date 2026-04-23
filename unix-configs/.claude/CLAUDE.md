# Global working preferences

## Commit metadata
- When making commits, never include any `Co-authored-by` trailers.

## Superpowers flow
- For complex features, larger refactors, and multi-step implementation work, use the `obra/superpowers` workflow by default.
- In that workflow, use the phases below and continue automatically between them unless there is a real ambiguity, a meaningful risk, or a decision that would be expensive to reverse.
- Brainstorming: use the brainstorming phase to clarify requirements with me. My approval of the design is the main approval step. After that approval, write the spec, run the brainstorming spec self-review loop, fix issues inline, and continue directly to planning. Do not stop for the separate "user reviews written spec" step in the normal case.
- Worktree setup: if work is continuing beyond brainstorming, create or reuse an isolated worktree before planning or implementation work when the environment allows it. If already inside an externally managed linked worktree, continue there instead of creating another one.
- Planning: after writing the implementation plan, run the writing-plans self-review loop, fix issues inline, and continue directly to implementation. Do not stop for the separate execution-choice prompt in the normal case.
- Implementation: after the planning self-review loop completes, default to `superpowers:subagent-driven-development` automatically. In this workflow, my approval to continue after brainstorming is sufficient authorization for the remaining automated superpowers phases, including subagents, delegation, and parallel agent work when appropriate. Do not pause to ask me which execution mode to use or to re-confirm subagent use unless there is a real safety, coordination, or cost concern.
- Use `superpowers:executing-plans` only if subagents are unavailable or the tasks are so tightly coupled that inline execution is clearly the better fit. On subagent-capable harnesses, treat `superpowers:subagent-driven-development` as the default path, not an optional preference.
- When implementation in that workflow can be parallelized safely, prefer subagent-driven development.
- Treat cleanup of temporary superpowers-generated docs as part of completing implementation, not part of finalizing a branch. Before reporting implementation complete, add a final cleanup commit that removes those docs, even if `superpowers:finishing-a-development-branch` is never used.
- These repo instructions override the default superpowers skill gates only where they conflict with this automation preference. Preserve the upstream brainstorming and writing-plans self-review loops. Override only the separate written-spec review stop and the separate execution-choice prompt unless one of the exceptions above applies.
