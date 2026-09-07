import { expect, test, vi } from "vitest";
import { createLiveness } from "./liveness";

const key = Symbol.for("@agegr/pi-web/session-liveness/v1");
const provider = (sessionId = "root", isActive = () => false) => ({
	name: "pi-subagents",
	sessionId,
	isActive,
});

test("v1 reads authoritative booleans for the exact producer and session", () => {
	const host = {};
	const reader = createLiveness(host);
	const registry = host[key];
	expect(registry.version).toBe(1);
	expect(reader.read("root")).toBeUndefined(); // Absence is not idle.
	registry.register({ ...provider(), name: "other-extension" });
	registry.register(provider("foreign"));
	expect(reader.read("root")).toBeUndefined();
	let active = false;
	const dispose = registry.register(provider("root", () => active));
	expect(reader.read("root")).toBe(false);
	active = true;
	expect(reader.read("root")).toBe(true);
	expect(reader.read("foreign")).toBe(false);
	expect(reader.read(undefined)).toBeUndefined();
	expect(reader.read("")).toBeUndefined();
	dispose();
	expect(reader.read("root")).toBeUndefined();
	reader.close();
	reader.close();
	expect(host[key]).toBeUndefined();
	expect(reader.read("foreign")).toBeUndefined();
});

test("module reload and stale provider/reader disposal cannot release a replacement", async () => {
	const host = {};
	const first = createLiveness(host);
	const registry = host[key];
	const value = provider("root", () => true);
	const releaseOld = registry.register(value);
	vi.resetModules();
	const { createLiveness: reloaded } = await import("./liveness");
	const second = reloaded(host);
	expect(host[key]).toBe(registry);
	const releaseNew = registry.register(value); // Same object, distinct registration.
	releaseOld();
	first.close();
	first.close();
	expect(first.read("root")).toBeUndefined();
	expect(second.read("root")).toBe(true);
	releaseNew();
	expect(second.read("root")).toBeUndefined();
	second.close();
	expect(host[key]).toBeUndefined();
	const third = reloaded(host);
	expect(host[key]).not.toBe(registry);
	expect(third.read("root")).toBeUndefined();
	third.close();
});

test.each([
	null,
	{},
	{ version: 2, register() {} },
	{ version: 1, register() {} },
	{ version: 1, register: false },
])(
	"foreign/malformed registry %j is neither modified nor queried",
	(foreign) => {
		const host = { [key]: foreign };
		const before = Object.getOwnPropertyDescriptors(host);
		const reader = createLiveness(host);
		expect(reader.read("root")).toBeUndefined();
		reader.close();
		expect(Object.getOwnPropertyDescriptors(host)).toEqual(before);
	},
);

test("a later host replacement is detected and never removed on shutdown", () => {
	const host = {};
	const reader = createLiveness(host);
	host[key].register(provider());
	expect(reader.read("root")).toBe(false);
	const foreign = { version: 1, register: vi.fn() };
	host[key] = foreign;
	expect(reader.read("root")).toBeUndefined();
	reader.close();
	expect(host[key]).toBe(foreign);
	expect(foreign.register).not.toHaveBeenCalled();
});

test("non-writable or throwing host slots fail closed", () => {
	for (const descriptor of [
		{ value: undefined },
		{
			get() {
				throw new Error("foreign registry");
			},
		},
	]) {
		const host = Object.defineProperty({}, key, descriptor);
		const before = Object.getOwnPropertyDescriptor(host, key);
		const reader = createLiveness(host);
		expect(reader.read("root")).toBeUndefined();
		reader.close();
		expect(Object.getOwnPropertyDescriptor(host, key)).toEqual(before);
	}
});

test.each([
	null,
	{},
	{ name: "", sessionId: "root", isActive() {} },
	{ name: "pi-subagents", sessionId: "", isActive() {} },
	{ name: "pi-subagents", sessionId: "root", isActive: false },
])("malformed provider %j is rejected, not mistaken for idle", (value) => {
	const host = {};
	const reader = createLiveness(host);
	expect(() => host[key].register(value)).toThrow(TypeError);
	expect(reader.read("root")).toBeUndefined();
	reader.close();
});

test.each([undefined, null, "false", 0, Promise.resolve(false)])(
	"non-boolean activity %j cannot prove completion",
	(value) => {
		const host = {};
		const reader = createLiveness(host);
		host[key].register(provider("root", () => value));
		expect(reader.read("root")).toBeUndefined();
		reader.close();
	},
);

test("provider failures and mutated identities fail closed", () => {
	const host = {};
	const reader = createLiveness(host);
	const value = provider("root", () => {
		throw new Error("unavailable");
	});
	host[key].register(value);
	expect(reader.read("root")).toBeUndefined();
	value.isActive = () => false;
	expect(reader.read("root")).toBe(false);
	value.sessionId = "foreign";
	expect(reader.read("root")).toBeUndefined();
	value.sessionId = "root";
	value.name = "foreign";
	expect(reader.read("root")).toBeUndefined();
	reader.close();
});

test("an incompatible async provider fails closed without an unhandled rejection", async () => {
	const host = {};
	const reader = createLiveness(host);
	host[key].register(
		provider("root", async () => {
			throw new Error("v2?");
		}),
	);
	expect(reader.read("root")).toBeUndefined();
	await new Promise((resolve) => setImmediate(resolve));
	reader.close();
});

test("late host access/permission changes cannot break reader shutdown", () => {
	for (const locked of [false, true]) {
		const host = {};
		const reader = createLiveness(host);
		host[key].register(provider());
		if (locked) Object.defineProperty(host, key, { configurable: false });
		else
			Object.defineProperty(host, key, {
				get() {
					throw new Error("replaced slot");
				},
			});
		expect(() => reader.close()).not.toThrow();
		expect(reader.read("root")).toBeUndefined();
	}
});
