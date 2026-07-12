export interface LoggedEvent {
	at: string;
	level: "debug" | "info" | "warn" | "error";
	message: string;
	meta?: Record<string, unknown>;
}

export interface EventLog {
	append(event: LoggedEvent): Promise<void>;
}
