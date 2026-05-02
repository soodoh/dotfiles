---
description: Summarize adaptive Do-It workflow results.
argument-hint: (no arguments)
---

# Final Do-It Report

Read whichever workflow artifacts exist:

- `$ARTIFACTS_DIR/assessment.json`
- `$ARTIFACTS_DIR/quick-summary.md`
- `$ARTIFACTS_DIR/standard-plan.md`
- `$ARTIFACTS_DIR/standard-state.json`
- `$ARTIFACTS_DIR/plan.md`
- `$ARTIFACTS_DIR/task-state.json`
- `$ARTIFACTS_DIR/progress.md`
- `$ARTIFACTS_DIR/reviews/`

Inspect git state:

```bash
git status --short
git log --oneline --no-merges $(git merge-base HEAD $BASE_BRANCH)..HEAD
git diff --stat $(git merge-base HEAD $BASE_BRANCH)..HEAD
```

Determine which path ran from `assessment.json` and existing artifacts:

- `quick`: summarize direct implementation and validation.
- `standard`: summarize whole-change PIV results, review rounds, status, and blockers if any.
- `deep`: summarize per-task implementation/review results, TDD, status, and blockers if any.

Return a concise final report with:

1. Mode selected and why
2. Summary of work completed
3. TDD performed/skipped, including reasons when available
4. Review results and review rounds, if applicable
5. Validation performed
6. Files changed
7. Remaining risks, blockers, or follow-ups

Do not modify files.
