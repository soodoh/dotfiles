import type { Message } from "@mariozechner/pi-ai";

interface ActiveSessionTranscript {
	systemPrompt: string;
	messages: Message[];
	contextUsagePercent?: number;
	sessionId?: string;
}

export interface SessionTranscriptProvider {
	getActiveTranscript(): ActiveSessionTranscript | undefined;
}
