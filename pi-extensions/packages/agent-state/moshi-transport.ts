import net from "node:net";

/** JSON-line/half-close/ack protocol. Latest state plus a resolution barrier; no retries. */
export function createMoshiWriter(endpoint: string) {
	let closed = false;
	let draining = false;
	const pending = new Map<"state" | "resolution", string>();
	let cancel: (() => void) | undefined;
	function attempt(line: string): Promise<void> {
		return new Promise((resolve) => {
			let socket: net.Socket | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let finished = false;
			function finish() {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				socket?.destroy();
				cancel = undefined;
				resolve();
			}
			cancel = finish;
			try {
				socket = net.createConnection(endpoint);
				socket.on("error", finish);
				socket.on("close", finish);
				socket.on("end", finish);
				socket.on("data", finish);
				socket.on("connect", () => {
					if (finished) return;
					socket?.write(line);
					socket?.end();
				});
				timer = setTimeout(finish, 1000);
				timer.unref();
			} catch {
				finish();
			}
		});
	}
	async function drain() {
		if (closed || draining) return;
		draining = true;
		try {
			while (!closed && pending.size > 0) {
				const next = pending.entries().next().value;
				if (!next) break;
				pending.delete(next[0]);
				await attempt(next[1]);
			}
		} finally {
			draining = false;
		}
	}
	return {
		send(envelope: Record<string, unknown>, resolution = false) {
			if (closed) return;
			// A resolved prompt supersedes any queued waiting state. Retain the
			// resolution before subsequent completion so Moshi clears its input marker.
			if (resolution) pending.delete("state");
			const key = resolution ? "resolution" : "state";
			pending.delete(key);
			pending.set(key, `${JSON.stringify(envelope)}\n`);
			void drain();
		},
		async close(final?: Record<string, unknown>) {
			if (closed) return;
			closed = true;
			pending.clear();
			cancel?.();
			// Only a real session quit closes Moshi's session. Teardown never completes a task.
			if (final) await attempt(`${JSON.stringify(final)}\n`);
		},
	};
}
