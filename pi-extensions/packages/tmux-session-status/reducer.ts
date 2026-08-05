export type PiSessionStatus =
	| "STARTING"
	| "THINKING"
	| "TOOL"
	| "WAITING"
	| "IDLE"
	| "ERROR";

export type ActiveTool = {
	id: string;
	name: string;
	startedAt: number;
};

export type LifecycleState = {
	status: PiSessionStatus;
	activeTools: readonly ActiveTool[];
	terminalError: boolean;
	aborted: boolean;
	stateChangedAt: number;
};

export type LifecycleEvent =
	| { type: "RESOURCES_READY"; at: number }
	| { type: "AGENT_STARTED"; at: number }
	| { type: "TOOL_STARTED"; id: string; name: string; at: number }
	| { type: "TOOL_FINISHED"; id: string; at: number }
	| {
			type: "ASSISTANT_FINISHED";
			stopReason: string;
			at: number;
	  }
	| { type: "AGENT_SETTLED"; paneFocused: boolean; at: number }
	| { type: "PANE_VISITED"; at: number };

export const initialLifecycleState = (at: number): LifecycleState => ({
	status: "STARTING",
	activeTools: [],
	terminalError: false,
	aborted: false,
	stateChangedAt: at,
});

const displayedTool = (state: LifecycleState): string | undefined =>
	state.activeTools.at(-1)?.name;

const withDisplayState = (
	state: LifecycleState,
	status: PiSessionStatus,
	at: number,
	activeTools: readonly ActiveTool[] = state.activeTools,
): LifecycleState => {
	const previousTool = displayedTool(state);
	const nextTool = activeTools.at(-1)?.name;
	const changed = state.status !== status || previousTool !== nextTool;
	return {
		...state,
		status,
		activeTools,
		stateChangedAt: changed ? at : state.stateChangedAt,
	};
};

export const reduceLifecycle = (
	state: LifecycleState,
	event: LifecycleEvent,
): LifecycleState => {
	switch (event.type) {
		case "RESOURCES_READY":
			return state.status === "STARTING"
				? withDisplayState(state, "IDLE", event.at)
				: state;
		case "AGENT_STARTED":
			return {
				...withDisplayState(state, "THINKING", event.at, []),
				terminalError: false,
				aborted: false,
			};
		case "TOOL_STARTED": {
			const activeTools = [
				...state.activeTools.filter((tool) => tool.id !== event.id),
				{ id: event.id, name: event.name, startedAt: event.at },
			];
			return withDisplayState(state, "TOOL", event.at, activeTools);
		}
		case "TOOL_FINISHED": {
			const activeTools = state.activeTools.filter(
				(tool) => tool.id !== event.id,
			);
			if (activeTools.length === state.activeTools.length) return state;
			return withDisplayState(
				state,
				activeTools.length > 0 ? "TOOL" : "THINKING",
				event.at,
				activeTools,
			);
		}
		case "ASSISTANT_FINISHED":
			if (event.stopReason === "error") {
				return { ...state, terminalError: true, aborted: false };
			}
			if (event.stopReason === "aborted") {
				return { ...state, terminalError: false, aborted: true };
			}
			return { ...state, terminalError: false, aborted: false };
		case "AGENT_SETTLED": {
			const status = state.terminalError
				? "ERROR"
				: state.aborted || event.paneFocused
					? "IDLE"
					: "WAITING";
			return withDisplayState(state, status, event.at, []);
		}
		case "PANE_VISITED":
			return state.status === "WAITING"
				? withDisplayState(state, "IDLE", event.at)
				: state;
	}
};

export const currentToolName = (state: LifecycleState): string | undefined =>
	displayedTool(state);
