import { EventEmitter } from "node:events";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import { type AgentStateDeps, createAgentState } from "./index";
import { registerActivity } from "./liveness.test.fixture";
import type { SocketLike } from "./socket-queue";

type Handler = (
	event: Record<string, unknown>,
	ctx: ExtensionContext,
) => unknown;

export type HerdrReport = { method: string; params: Record<string, unknown> };

export type FakeSocket = EventEmitter & {
	destroy: ReturnType<typeof vi.fn<() => void>>;
	end: ReturnType<typeof vi.fn<() => void>>;
	write: (line: string) => void;
};

export const HERDR_SOCKET = "/fixture-herdr.sock";
export const MOSHI_SOCKET = "/fixture-moshi.sock";

export async function flush(turns = 5): Promise<void> {
	for (let n = 0; n < turns; n++) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

export type AgentStateHarnessOptions = {
	mode?: ExtensionContext["mode"];
	env?: NodeJS.ProcessEnv;
	herdr?: boolean;
	platform?: AgentStateDeps["platform"];
	homedir?: AgentStateDeps["homedir"];
	execTmux?: AgentStateDeps["execTmux"];
	connect?: AgentStateDeps["connect"];
	cwd?: string;
	model?: { id: string; name: string };
	sessionId?: string;
	sessionFile?: string | undefined;
	autoFlush?: boolean;
	autoRespondMoshi?: boolean;
	shutdownReason?: string;
	/** Required so afterEach always releases the global liveness producer registered by the harness. */
	cleanups: Array<() => Promise<void>>;
};

export function createAgentStateHarness(options: AgentStateHarnessOptions) {
	const mode = options.mode ?? "tui";
	const autoFlush = options.autoFlush ?? false;
	let respondHerdr = true;
	let respondMoshi = options.autoRespondMoshi ?? true;
	const reports: HerdrReport[] = [];
	const envelopes: Record<string, unknown>[] = [];
	const endpoints: string[] = [];
	const sockets: FakeSocket[] = [];
	const moshiSockets: FakeSocket[] = [];
	const env: NodeJS.ProcessEnv =
		options.herdr === true
			? {
					HERDR_ENV: "1",
					HERDR_SOCKET_PATH: HERDR_SOCKET,
					HERDR_PANE_ID: "w1:p1",
					MOSHI_SOCKET_PATH: MOSHI_SOCKET,
					PI_SUBAGENT_CHILD: "0",
					...options.env,
				}
			: {
					MOSHI_SOCKET_PATH: MOSHI_SOCKET,
					...options.env,
				};
	const herdrSocketPath = env.HERDR_SOCKET_PATH;

	const connect =
		options.connect ??
		((endpoint: string): SocketLike => {
			endpoints.push(endpoint);
			const isHerdr =
				herdrSocketPath !== undefined && endpoint === herdrSocketPath;
			const socket: FakeSocket = Object.assign(new EventEmitter(), {
				destroy: vi.fn<() => void>(),
				end: vi.fn<() => void>(),
				write: (line: string) => {
					const parsed = JSON.parse(line);
					if (isHerdr) {
						reports.push(parsed);
						if (respondHerdr) {
							queueMicrotask(() => socket.emit("data", Buffer.from("{}\n")));
						}
					} else {
						envelopes.push(parsed);
						if (respondMoshi) {
							queueMicrotask(() => socket.emit("data", Buffer.from("{}\n")));
						}
					}
				},
			});
			if (isHerdr) sockets.push(socket);
			else moshiSockets.push(socket);
			queueMicrotask(() => socket.emit("connect"));
			return socket;
		});

	const handlers = new Map<string, Handler[]>();
	const bus = new EventEmitter();
	let active = false;
	let available = true;
	const extension = createAgentState({
		env,
		connect,
		platform: options.platform,
		homedir: options.homedir,
		execTmux: options.execTmux,
	});
	extension({
		on: (event: string, handler: Handler) =>
			handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		events: {
			emit: (event: string, data: unknown) => bus.emit(event, data),
			on: (event: string, handler: (data: unknown) => void) => {
				bus.on(event, handler);
				return () => bus.off(event, handler);
			},
		},
	} as unknown as ExtensionAPI);

	const sessionId = options.sessionId ?? "root-session";
	const releaseActivity = registerActivity(
		() => (available ? active : undefined),
		sessionId,
	);
	let idle = true;
	let pending = false;
	let file: string | undefined =
		"sessionFile" in options ? options.sessionFile : "/tmp/root-session.jsonl";
	const ctx = {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		cwd: options.cwd ?? "/tmp/test-project",
		model: options.model,
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		ui: { notify: vi.fn() },
		sessionManager: {
			getSessionFile: () => file,
			getSessionId: () => sessionId,
		},
	} as unknown as ExtensionContext;

	async function dispatch(event: string, data: Record<string, unknown> = {}) {
		for (const handler of handlers.get(event) ?? []) {
			await handler({ type: event, messages: [], ...data }, ctx);
		}
		if (autoFlush) await flush();
	}

	async function start(reason = "startup") {
		await dispatch("session_start", { reason });
		await dispatch("resources_discover", { reason });
		if (!autoFlush) await flush(3);
	}

	async function begin() {
		idle = false;
		await dispatch("agent_start");
	}

	async function settle(stopReason = "stop") {
		await dispatch("agent_end", {
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "secret reply" }],
					stopReason,
				},
			],
		});
		idle = true;
		await dispatch("agent_settled");
	}

	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		try {
			await dispatch("session_shutdown", {
				reason: options.shutdownReason ?? "quit",
			});
		} finally {
			releaseActivity();
		}
		if (!autoFlush) await flush(3);
	};
	options.cleanups.push(close);

	return {
		reports,
		envelopes,
		endpoints,
		sockets,
		moshiSockets,
		bus,
		ctx,
		dispatch,
		start,
		begin,
		settle,
		close,
		states: () =>
			reports
				.filter((r) => r.method === "pane.report_agent")
				.map((r) => r.params.state),
		categories: () =>
			envelopes
				.filter((e) => e.source === "pi")
				.map((e) => e.category)
				.filter(Boolean),
		setActive: (value: boolean) => {
			active = value;
		},
		setAvailable: (value: boolean) => {
			available = value;
		},
		setIdle: (value: boolean) => {
			idle = value;
		},
		setPending: (value: boolean) => {
			pending = value;
		},
		setFile: (value: string | undefined) => {
			file = value;
		},
		setRespond: (value: boolean) => {
			respondHerdr = value;
		},
		setRespondMoshi: (value: boolean) => {
			respondMoshi = value;
		},
	};
}
