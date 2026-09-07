import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { createMoshiWriter } from "./moshi-transport";

const writers: ReturnType<typeof createMoshiWriter>[] = [];
async function flush() {
	for (let n = 0; n < 4; n++)
		await new Promise<void>((resolve) => setImmediate(resolve));
}
function fixture() {
	const sockets: EventEmitter[] = [];
	const lines: Record<string, unknown>[] = [];
	vi.spyOn(net, "createConnection").mockImplementation((() => {
		const socket = new EventEmitter();
		Object.assign(socket, {
			destroy: vi.fn(),
			end: vi.fn(),
			write: (line: string) => lines.push(JSON.parse(line)),
		});
		sockets.push(socket);
		queueMicrotask(() => socket.emit("connect"));
		return socket;
	}) as unknown as typeof net.createConnection);
	const writer = createMoshiWriter("/fixture-only.sock");
	writers.push(writer);
	return { writer, sockets, lines };
}
afterEach(async () => {
	for (const writer of writers.splice(0)) await writer.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("ordered latest state suppresses obsolete waiting/completion updates", async () => {
	const f = fixture();
	f.writer.send({ state: "initial" });
	await flush();
	f.writer.send({ state: "blocked" });
	f.writer.send({ state: "complete" });
	f.writer.send({ state: "working" });
	f.sockets[0]?.emit("data", Buffer.from("{}\n"));
	await flush();
	expect(f.lines).toEqual([{ state: "initial" }, { state: "working" }]);
	expect((f.sockets[0] as unknown as net.Socket).end).toHaveBeenCalled();
});

test("prompt resolution survives conflation before completion", async () => {
	const f = fixture();
	f.writer.send({ state: "blocked" });
	await flush();
	f.writer.send({ state: "obsolete" });
	f.writer.send({ eventName: "PermissionResolved" }, true);
	f.writer.send({ category: "task_complete" });
	f.sockets[0]?.emit("data", Buffer.from("{}\n"));
	await flush();
	f.sockets[1]?.emit("data", Buffer.from("{}\n"));
	await flush();
	expect(f.lines).toEqual([
		{ state: "blocked" },
		{ eventName: "PermissionResolved" },
		{ category: "task_complete" },
	]);
});

test.each(["error", "end", "close"])(
	"%s fails silently without retrying a notification",
	async (event) => {
		const f = fixture();
		f.writer.send({ category: "task_complete" });
		await flush();
		f.sockets[0]?.emit(event, new Error("fixture failure"));
		await flush();
		expect(f.sockets).toHaveLength(1);
		expect((f.sockets[0] as unknown as net.Socket).destroy).toHaveBeenCalled();
	},
);

test("stalled daemon attempts are bounded and shutdown cancels unsent work", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const f = fixture();
	f.writer.send({ first: true });
	await flush();
	await vi.advanceTimersByTimeAsync(1000);
	expect((f.sockets[0] as unknown as net.Socket).destroy).toHaveBeenCalled();
	f.writer.send({ second: true });
	await flush();
	f.writer.send({ mustNotSend: true });
	await f.writer.close();
	f.writer.send({ mustNotSend: true });
	await vi.advanceTimersByTimeAsync(1000);
	await flush();
	expect(f.lines).toEqual([{ first: true }, { second: true }]);
});

test("a real quit cancels stale reports and sends only the session closure", async () => {
	const f = fixture();
	f.writer.send({ first: true });
	await flush();
	f.writer.send({ mustNotSend: true });
	const closing = f.writer.close({ type: "session.closed" });
	await flush();
	f.sockets[1]?.emit("data", Buffer.from("{}\n"));
	await closing;
	expect(f.lines).toEqual([{ first: true }, { type: "session.closed" }]);
});

test("synchronous connection failure cannot escape", async () => {
	const f = fixture();
	vi.mocked(net.createConnection).mockImplementation(() => {
		throw new Error("no transport");
	});
	expect(() => f.writer.send({ category: "task_complete" })).not.toThrow();
	await flush();
	expect(f.lines).toEqual([]);
});
