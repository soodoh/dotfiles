# Global working preferences

## Superpowers flow
- For complex features, larger refactors, and multi-step implementation work, prefer the `obra/superpowers` workflow.
- In that workflow, use the brainstorming phase to clarify requirements with me. My feedback and confirmation during that interview should be treated as the main approval step.
- After brainstorming approval, do not stop for additional manual approval gates just to review the written spec.
- Write the spec, self-review it, and continue directly to planning unless there is a real ambiguity, meaningful risk, or an expensive-to-reverse decision.
- If work is continuing beyond brainstorming, create or reuse an isolated worktree before planning or implementation work when the environment allows it. If already inside an externally managed linked worktree, continue there instead of creating another one.
- After writing the implementation plan, self-review it and continue immediately into execution.
- Do not pause to ask me which execution mode to use. Default to `superpowers:subagent-driven-development`.
- Use `superpowers:executing-plans` only if subagents are unavailable or the tasks are tightly coupled enough that inline execution is clearly the better fit.
- When implementation can be parallelized safely, prefer subagent-driven development.
- When finalizing a branch created with the superpowers workflow, add a final cleanup commit that removes any superpowers-generated docs before considering the branch complete.
- Only stop for confirmation after brainstorming if there is a real ambiguity, a meaningful risk, or a decision that would be expensive to reverse.

## Worktrees by default
- For new implementation work, prefer using a git worktree instead of modifying the current checkout directly.
- Prefer project-local worktrees in `<repo>/.worktrees/`.
- Ensure `.worktrees/` is gitignored before creating a worktree. If it is not ignored yet, add it to the repository `.gitignore` first.
- Reuse an existing `.worktrees/` directory when present. If no project-local worktree directory exists yet, create `.worktrees/` in the current repository and use it.
