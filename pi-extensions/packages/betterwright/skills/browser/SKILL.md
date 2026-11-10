---

name: browser
description: Operate BetterWright through Pi’s native browser tools for UI interaction, visual verification, and browser-only content. Use for form workflows, authenticated pages unavailable through specialized tools, screenshots, and real UI testing.
---

# Browser interaction in Pi

Apply the session’s tool-routing guardrails before starting browser work. Once browser use is warranted:

1. Use `browser_evidence` to initialize the task requirements, then drive the persistent session with `browser`. Use `browser_download` only for an approved remote-file download.
2. Follow the injected “Operating the browser” guidance for observation, batching, challenges, handoff, and verification. Use Pi’s native tools rather than the standalone CLI.
3. Verify the visible outcome, prove only requirements established on the page, and audit the checklist before reporting completion.

Read the bundled [browser API reference](../../../../node_modules/betterwright/docs/browser-api.md) when a helper’s arguments or return shape are unclear. The session guardrails remain authoritative for routing and credentials; use the configured Bitwarden adapter for credential fills.
