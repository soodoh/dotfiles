import { expect, test } from "vitest";
import { InMemoryTaskQueue } from "../../../src/infra/queue/in-memory-task-queue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolvePromise = (): void => undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

test("InMemoryTaskQueue serializes tasks with the same name", async () => {
	const queue = new InMemoryTaskQueue();
	const releaseFirst = deferred();
	const firstStarted = deferred();
	const events: string[] = [];

	const first = queue.enqueue("same", async () => {
		events.push("first:start");
		firstStarted.resolve();
		await releaseFirst.promise;
		events.push("first:end");
	});
	await firstStarted.promise;

	const second = queue.enqueue("same", async () => {
		events.push("second");
	});
	await Promise.resolve();

	expect(events).toEqual(["first:start"]);
	releaseFirst.resolve();
	await Promise.all([first, second]);
	expect(events).toEqual(["first:start", "first:end", "second"]);
});

test("InMemoryTaskQueue runs independent task names concurrently", async () => {
	const queue = new InMemoryTaskQueue();
	const releaseFirst = deferred();
	const firstStarted = deferred();
	const secondStarted = deferred();
	const events: string[] = [];

	const first = queue.enqueue("first", async () => {
		events.push("first:start");
		firstStarted.resolve();
		await releaseFirst.promise;
		events.push("first:end");
	});
	await firstStarted.promise;

	const second = queue.enqueue("second", async () => {
		events.push("second");
		secondStarted.resolve();
	});
	await secondStarted.promise;

	expect(events).toEqual(["first:start", "second"]);
	releaseFirst.resolve();
	await Promise.all([first, second]);
	expect(events).toEqual(["first:start", "second", "first:end"]);
});

test("InMemoryTaskQueue cleans up rejected tasks before later work", async () => {
	const queue = new InMemoryTaskQueue();
	const error = new Error("boom");

	await expect(
		queue.enqueue("rejecting", async () => {
			throw error;
		}),
	).rejects.toThrow(error);

	expect(queue.isRunning("rejecting")).toBe(false);
	await expect(queue.enqueue("rejecting", async () => undefined)).resolves.toBe(
		undefined,
	);
});

test("InMemoryTaskQueue reports isRunning only while a named task is active", async () => {
	const queue = new InMemoryTaskQueue();
	const release = deferred();
	const started = deferred();

	expect(queue.isRunning("tracked")).toBe(false);
	const task = queue.enqueue("tracked", async () => {
		started.resolve();
		expect(queue.isRunning("tracked")).toBe(true);
		await release.promise;
	});
	await started.promise;
	expect(queue.isRunning("tracked")).toBe(true);

	release.resolve();
	await task;
	expect(queue.isRunning("tracked")).toBe(false);
});
