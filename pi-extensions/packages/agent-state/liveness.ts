// Upstream's versioned host protocol; no imports from pi-subagents internals.
const KEY = Symbol.for("@agegr/pi-web/session-liveness/v1");
const OWNER = Symbol.for("dotfiles.agent-state/session-liveness-owner/v1");
type Host = Record<PropertyKey, unknown>;
type Provider = {
	name: string;
	sessionId: string;
	isActive(): boolean;
};
type Registration = { provider: Provider; name: string; sessionId: string };
type Registry = {
	version: 1;
	register(provider: Provider): () => void;
	[OWNER]: {
		readers: Set<symbol>;
		providers: Map<string, Registration>;
	};
};

function createRegistry(): Registry {
	const providers = new Map<string, Registration>();
	return Object.freeze({
		version: 1,
		[OWNER]: { readers: new Set<symbol>(), providers },
		register(provider: Provider) {
			if (
				!provider ||
				typeof provider.name !== "string" ||
				!provider.name ||
				typeof provider.sessionId !== "string" ||
				!provider.sessionId ||
				typeof provider.isActive !== "function"
			)
				throw new TypeError("Invalid session-liveness v1 provider");
			const { name, sessionId } = provider;
			const key = JSON.stringify([name, sessionId]);
			const registration = { provider, name, sessionId };
			providers.set(key, registration);
			return () => {
				// An old runtime must not unregister its replacement, even when the
				// same provider object was registered twice.
				if (providers.get(key) === registration) providers.delete(key);
			};
		},
	});
}

/**
 * Advertise before session_start (independent of extension order). The dormant
 * registry opens no I/O/timers. Non-TUI runtimes immediately close their lease.
 * Ownership survives module reloads; foreign registries are never wrapped/read.
 * Undefined means unavailable evidence, NOT idle. The caller gates restoration.
 */
export function createLiveness(host: Host = globalThis as Host) {
	let registry: Registry | undefined;
	const reader = Symbol();
	try {
		if (host[KEY] === undefined) host[KEY] = createRegistry();
		const candidate = host[KEY] as Registry | undefined;
		if (
			candidate?.version === 1 &&
			typeof candidate.register === "function" &&
			candidate[OWNER]?.readers instanceof Set &&
			candidate[OWNER]?.providers instanceof Map
		) {
			registry = candidate;
			registry[OWNER].readers.add(reader);
		}
	} catch {
		// A reserved/non-writable slot is not ours to repair.
	}
	return {
		read(sessionId: string | undefined): boolean | undefined {
			try {
				if (!registry || !sessionId || host[KEY] !== registry) return undefined;
				const entry = registry[OWNER].providers.get(
					JSON.stringify(["pi-subagents", sessionId]),
				);
				if (
					!entry ||
					entry.provider.name !== entry.name ||
					entry.provider.sessionId !== sessionId
				)
					return undefined;
				const active: unknown = entry.provider.isActive();
				// v1 is synchronous. Drain an incompatible async provider's rejection
				// without accepting its eventual value as completion evidence.
				if (active instanceof Promise) void active.catch(() => {});
				return typeof active === "boolean" ? active : undefined;
			} catch {
				return undefined;
			}
		},
		close() {
			if (!registry) return;
			registry[OWNER].readers.delete(reader);
			if (registry[OWNER].readers.size === 0) {
				registry[OWNER].providers.clear();
				try {
					// A later host may have replaced or locked the slot.
					if (host[KEY] === registry) delete host[KEY];
				} catch {
					// Never repair a foreign host's slot during teardown.
				}
			}
			registry = undefined;
		},
	};
}
