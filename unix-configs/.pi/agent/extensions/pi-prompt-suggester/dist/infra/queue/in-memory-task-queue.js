export class InMemoryTaskQueue {
    tails = new Map();
    running = new Set();
    async enqueue(name, task) {
        const previous = this.tails.get(name) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
            this.running.add(name);
            try {
                await task();
            }
            finally {
                this.running.delete(name);
            }
        });
        this.tails.set(name, next);
        try {
            await next;
        }
        finally {
            if (this.tails.get(name) === next) {
                this.tails.delete(name);
            }
        }
    }
    isRunning(name) {
        return this.running.has(name);
    }
}
