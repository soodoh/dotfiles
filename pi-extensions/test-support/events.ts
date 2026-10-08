import type { AgentSettledEvent } from "@earendil-works/pi-coding-agent";

// Keep synthetic lifecycle defaults checked against the installed host SDK.
export function agentSettledEvent(aborted = false): AgentSettledEvent {
	return { type: "agent_settled", aborted };
}
