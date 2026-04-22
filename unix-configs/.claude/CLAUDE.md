# Global working preferences

## Commit metadata
- When making commits, never include any `Co-authored-by` trailers.

## Superpowers flow
- For complex features, larger refactors, and multi-step implementation work, use the `obra/superpowers` workflow by default.
- In that workflow, use the brainstorming phase to clarify requirements with me.
- My approval of the design during brainstorming is the main approval step. After that approval, do not stop for a separate request that I review or approve the written spec unless there is a real ambiguity, a meaningful risk, or a decision that would be expensive to reverse.
- After brainstorming approval, write the spec, self-review it, and continue directly to planning unless one of those exceptions applies.
- If work is continuing beyond brainstorming, create or reuse an isolated worktree before planning or implementation work when the environment allows it. If already inside an externally managed linked worktree, continue there instead of creating another one.
- After writing the implementation plan, self-review it and continue directly into execution unless there is a real ambiguity, a meaningful risk, or a decision that would be expensive to reverse.
- Within the `obra/superpowers` workflow only, my approval to continue after brainstorming or my approval of the implementation plan is explicit authorization to use subagents, delegation, and parallel agent work for implementation when appropriate.
- In that workflow, do not pause to ask me which execution mode to use or to re-confirm subagent use unless there is a real safety, coordination, or cost concern.
- In the `obra/superpowers` workflow, default to `superpowers:subagent-driven-development` after the approval described above.
- Use `superpowers:executing-plans` only if subagents are unavailable, not explicitly authorized in that workflow state, or the tasks are tightly coupled enough that inline execution is clearly the better fit.
- When implementation in that workflow can be parallelized safely, prefer subagent-driven development.
- Treat cleanup of temporary superpowers-generated docs as part of completing implementation, not part of finalizing a branch. Before reporting implementation complete, add a final cleanup commit that removes those docs, even if `superpowers:finishing-a-development-branch` is never used.
- These repo instructions override the default superpowers skill gates where they conflict, especially the brainstorming skill's written-spec review stop and the writing-plans skill's execution-choice prompt.
