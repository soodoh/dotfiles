import type { Clock } from "../../app/ports/clock";

export class SystemClock implements Clock {
	public nowIso(): string {
		return new Date().toISOString();
	}
}
