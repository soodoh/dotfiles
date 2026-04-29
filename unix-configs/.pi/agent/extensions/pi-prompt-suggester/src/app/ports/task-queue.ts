export interface TaskQueue {
	enqueue(name: string, task: () => Promise<void>): Promise<void>;
	isRunning(name: string): boolean;
}