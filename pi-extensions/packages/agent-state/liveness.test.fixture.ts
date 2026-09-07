// Fake provider at the real host-protocol seam; never mock the state owner.
export function registerActivity(
	isActive: () => unknown,
	sessionId = "root-session",
) {
	const provider = { name: "pi-subagents", sessionId, isActive };
	const registry = (globalThis as Record<PropertyKey, unknown>)[
		Symbol.for("@agegr/pi-web/session-liveness/v1")
	] as { register(value: typeof provider): () => void } | undefined;
	return registry?.register(provider) ?? (() => {});
}
