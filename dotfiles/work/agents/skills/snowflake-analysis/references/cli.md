# CLI execution reference

## Connection and authentication

Use the installed `snow ... --help` for version-specific flags. Select an explicit
named connection with `--connection`; use its existing authentication instead of
passing passwords or tokens. `externalbrowser` authentication can require a human
SSO step. Keep automatic browser launch in the approved work profile; if that
cannot be guaranteed, suppress automatic launch and ask the human to authenticate
through the approved visible browser. Do not print captured authentication URLs
or inspect credential caches. Resume after the human confirms completion.

For discovery, capture `snow connection list --all --format json` and project only
connection names and public connection parameters. A `parameters` field may be a
mapping or a string representation of a mapping; parse it safely, never `eval`.
Keep raw output and subprocess errors out of shared logs.

## Construct commands without shell interpolation

Prefer `snow sql --connection CONNECTION --stdin --local-only --format json
--enhanced-exit-codes`, supplying reviewed SQL through standard input. Python's
`subprocess.run` with an argument list and captured output avoids quoting errors
with SQL identifiers and functions containing `$`. Capture both stdout and stderr;
inspect exit status before parsing stdout, and redact errors before sharing them.

For a reviewed local SQL file, use `--filename PATH --local-only` instead of
`--stdin`. `--local-only` prevents remote `!source`/`!load` directives; it does not
make arbitrary SQL safe. Read the entire file and its local includes before use.
Run only trusted, reviewed SQL; a `SELECT` can call a side-effecting function.

Set timeouts in the **same invocation/session** as the query:

```sql
ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 30,
                  STATEMENT_QUEUED_TIMEOUT_IN_SECONDS = 15;
SELECT /* reviewed, scoped expressions */ 1 AS connection_ok;
```

These are session-local controls, not account/warehouse changes. Select a timeout
appropriate to the approved task; do not increase it automatically after failure.
A subprocess timeout alone does not prove server-side cancellation. A statement
may have completed even when its result was lost; do not blindly replay requests.

Multi-statement JSON includes results for session settings as well as queries.
Inspect its actual structure and each statement status; don't treat the first
result as the requested data. Keep query IDs in local diagnostics when available;
`LAST_QUERY_ID()` is session-scoped and a new CLI process opens a new session.
Do not promise `RESULT_SCAN` reuse across unrelated CLI invocations.

## Analytical checks

- **Scope:** fully qualify verified objects; quote identifiers with Snowflake's
  double-quote rules rather than interpolating untrusted object names.
- **Time:** distinguish `TIMESTAMP_NTZ`, `LTZ`, and `TZ`; state the reporting
  timezone. Bind explicit start/end values instead of relying on session defaults.
- **Deduplication:** use `QUALIFY ROW_NUMBER() ... = 1` with a deterministic tie-breaker.
- **Joins:** aggregate the many-side before joining; compare base and joined counts
  and totals. A `DISTINCT` added after a fanout is not a general repair.
- **Ratios:** define the denominator and use `NULLIF(denominator, 0)` when NULL is
  the intended undefined-ratio result. Do not silently substitute zero.
- **VARIANT:** use typed path access and `LATERAL FLATTEN`; account for row expansion
  and missing/empty arrays before aggregating.
- **Cost:** use narrow time predicates and appropriate columns; warehouse resizing,
  clustering changes, materialization, and search optimization are outside this
  read-only skill. Use EXPLAIN for estimates when authorized, not an unbounded run.

Prefer current official documentation for unfamiliar syntax. No Marketplace
installation, legal-term acceptance, or documentation database creation is needed
for this skill.
