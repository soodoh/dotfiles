# GitHub review-thread GraphQL recipes

`skill_dir` is the directory containing the invoking `SKILL.md`; `host`, `owner`, `repo`, and `number` come from the **current branch's PR**. Use these saved queries intact instead of rebuilding one-line GraphQL strings. Pass every call to `gh api --hostname "$host" graphql`; omit `--jq` until the response has been checked for `errors` and required `data` nodes. The files are:

- `review-threads.graphql` — paginated threads with their first 100 comments.
- `thread-comments.graphql` — remaining comments on one thread.
- `reply.graphql` — reply by thread ID, returning `comment { id url }` (the reply payload does not expose `thread`).
- `resolve.graphql` — resolve by thread ID, returning `thread { id isResolved }`.

## Read before acting

```bash
gh api --hostname "$host" graphql \
  -f query="$(< "$skill_dir/references/review-threads.graphql")" \
  -f owner="$owner" -f repo="$repo" -F number="$number"
```

Omit `-f cursor` on the first page; on subsequent pages add `-f cursor="$end_cursor"` until `hasNextPage` is false. For each thread whose comment page has `hasNextPage: true`, append the remaining pages via:

```bash
gh api --hostname "$host" graphql \
  -f query="$(< "$skill_dir/references/thread-comments.graphql")" \
  -f thread="$thread_id" -f cursor="$comment_end_cursor"
```

Verify `errors` is absent and `data.repository.pullRequest.reviewThreads` (or `data.node.comments`) is present before using results. An HTTP-success response containing GraphQL `errors` is not success. Fully paginate before deciding thread ownership, deduplication, or resolution. `Actor` supports `login` and `__typename`, but not `id`; the saved queries use an inline `Bot` fragment for bot ID. GitHub App bots can exist as comment authors without a REST `/users/<login>` resource.

## Write after checking PR head and existing replies

```bash
gh api --hostname "$host" graphql \
  -f query="$(< "$skill_dir/references/reply.graphql")" \
  -f thread="$thread_id" -f body="$reply"
```

Require `data.addPullRequestReviewThreadReply.comment.id` and `.url`, then re-fetch the thread. When it is eligible for resolution:

```bash
gh api --hostname "$host" graphql \
  -f query="$(< "$skill_dir/references/resolve.graphql")" \
  -f thread="$thread_id"
```

Require the returned thread ID to match the requested ID and `isResolved` to be true; confirm in a fresh thread scan.

If the host rejects a field or syntax, introspect the input or payload type with `__type` on **that host**, adapt a temporary copy for that host rather than silently changing the shared recipe, and re-fetch the thread before any mutation attempt. After *any* mutation error or uncertain response, re-fetch the thread and inspect comment IDs/authors and resolution state before considering a retry: a write might have succeeded despite a client-side error. Retry only when the intended change is confirmed absent. Stop and report persistent schema, authentication, permission, or ambiguous-state errors.
