import type { Clock } from "../../app/ports/clock.js";

export class SystemClock implements Clock {
	public nowIso(): string {
		return new Date().toISOString();
	}
}
