import type { TaskQueue } from "../../app/ports/task-queue.js";

export class InMemoryTaskQueue implements TaskQueue {
	private readonly tails = new Map<string, Promise<void>>();
	private readonly running = new Set<string>();

	public async enqueue(name: string, task: () => Promise<void>): Promise<void> {
		const previous = this.tails.get(name) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(async () => {
				this.running.add(name);
				try {
					await task();
				} finally {
					this.running.delete(name);
				}
			});

		this.tails.set(name, next);
		try {
			await next;
		} finally {
			if (this.tails.get(name) === next) {
				this.tails.delete(name);
			}
		}
	}

	public isRunning(name: string): boolean {
		return this.running.has(name);
	}
}
