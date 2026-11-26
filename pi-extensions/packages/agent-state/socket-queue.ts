import net from "node:net";

export type SocketLike = {
	on(event: string, listener: (...args: unknown[]) => void): unknown;
	write(data: string): unknown;
	end(): unknown;
	destroy(): unknown;
};

export type ConnectSocket = (endpoint: string) => SocketLike;

/**
 * Single-flight, key-coalescing JSON-line Unix socket queue shared by agent-state
 * destination adapters. Never throws and never leaves open handles at shutdown.
 */
export function createSocketQueue<K extends string>(options: {
	endpoint: string;
	connect?: ConnectSocket;
	timeoutMs: number;
	retryTimeoutMs?: number;
	halfClose?: boolean;
}) {
	const connect: ConnectSocket =
		options.connect ?? ((endpoint) => net.createConnection(endpoint));
	const pending = new Map<K, string>();
	let closed = false;
	let draining = false;
	let cancelAttempt: (() => void) | undefined;

	function attempt(line: string, timeoutMs: number): Promise<boolean> {
		return new Promise((resolve) => {
			let finished = false;
			let socket: SocketLike | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (delivered: boolean) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				cancelAttempt = undefined;
				socket?.destroy();
				resolve(delivered);
			};
			cancelAttempt = () => finish(false);
			try {
				socket = connect(options.endpoint);
				socket.on("error", () => finish(false));
				socket.on("end", () => finish(false));
				socket.on("close", () => finish(false));
				socket.on("connect", () => {
					if (finished) return;
					socket?.write(line);
					if (options.halfClose) socket?.end();
				});
				socket.on("data", () => finish(true));
				timer = setTimeout(() => finish(false), timeoutMs);
				timer.unref();
			} catch {
				finish(false);
			}
		});
	}

	async function drain() {
		if (draining || closed) return;
		draining = true;
		try {
			while (!closed && pending.size > 0) {
				const next = pending.entries().next().value;
				if (!next) break;
				const [key, line] = next;
				pending.delete(key);
				const delivered = await attempt(line, options.timeoutMs);
				// Never retry an obsolete report after a newer report was queued.
				if (
					!delivered &&
					options.retryTimeoutMs !== undefined &&
					!closed &&
					!pending.has(key)
				) {
					await attempt(line, options.retryTimeoutMs);
				}
			}
		} finally {
			draining = false;
		}
	}

	return {
		enqueue(key: K, line: string, clearKeys?: readonly K[]) {
			if (closed) return;
			if (clearKeys) {
				for (const other of clearKeys) pending.delete(other);
			}
			// At most one pending report per key; reinsertion preserves order.
			pending.delete(key);
			pending.set(key, line);
			void drain();
		},
		close() {
			if (closed) return false;
			closed = true;
			pending.clear();
			cancelAttempt?.();
			return true;
		},
		async sendImmediate(line: string) {
			await attempt(line, options.timeoutMs);
		},
	};
}
