import { describe, expect, test, vi } from "vitest";
import {
	type AutoTitleState,
	createTitleOwnershipState,
	type GenerationLease,
} from "./title-ownership";

const INITIAL_STATE: AutoTitleState = {
	title: "Fix login redirect",
	originalRequest: "Fix the OAuth redirect loop",
	phase: "initial",
	refinementAttempted: false,
	initialFallback: false,
};

function requireLease<T extends GenerationLease>(lease: T | undefined): T {
	expect(lease).toBeDefined();
	if (!lease) throw new Error("expected lease");
	return lease;
}

describe("createTitleOwnershipState", () => {
	test("releases ownership and aborts in-flight refinement when session name is cleared to undefined", () => {
		const state = createTitleOwnershipState({
			maxRecentRawRequests: 4,
			timeoutMs: 5_000,
		});
		const persisted: AutoTitleState[] = [];

		const initialLease = requireLease(state.beginInitial(undefined));
		expect(
			initialLease.commit(
				{ name: undefined, released: false },
				INITIAL_STATE,
				(committed) => {
					state.handleSessionInfoChanged(committed.title, (s) =>
						persisted.push(s),
					);
				},
			),
		).toBe(true);
		initialLease.finish();

		const refinementLease = requireLease(
			state.beginRefinement(INITIAL_STATE.title, {
				name: INITIAL_STATE.title,
				released: false,
			}),
		);
		const generation = refinementLease.createController(undefined);

		// Clearing the title fires session_info_changed with name === undefined.
		state.handleSessionInfoChanged(undefined, (s) => persisted.push(s));

		expect(generation.controller.signal.aborted).toBe(true);
		expect(state.refinementCandidate()).toBeUndefined();
		expect(persisted).toEqual([{ ...INITIAL_STATE, ownershipReleased: true }]);
		expect(
			refinementLease.commit(
				{ name: INITIAL_STATE.title, released: false },
				{
					...INITIAL_STATE,
					title: "Refined title",
					phase: "refinement",
					refinementAttempted: true,
				},
				() => {
					throw new Error("should not apply after ownership release");
				},
			),
		).toBe(false);

		generation.cleanup();
		refinementLease.finish();
	});

	test("stale lease createController aborts immediately without clobbering a newer epoch controller", () => {
		const state = createTitleOwnershipState({
			maxRecentRawRequests: 4,
			timeoutMs: 5_000,
		});

		const staleLease = requireLease(state.beginInitial(undefined));

		// Branch restore advances the epoch and supersedes staleLease.
		state.restore({
			branchState: undefined,
			titleInfo: { name: undefined, released: false },
			hasExistingRequests: false,
		});

		const currentLease = requireLease(state.beginInitial(undefined));
		const activeGen = currentLease.createController(undefined);

		// Calling createController on the stale lease must immediately abort and
		// must not replace activeGen's controller.
		const staleGen = staleLease.createController(undefined);
		expect(staleGen.controller.signal.aborted).toBe(true);
		expect(activeGen.controller.signal.aborted).toBe(false);

		// Manual rename must still abort activeGen's controller.
		state.handleSessionInfoChanged("Manual Title", vi.fn());
		expect(activeGen.controller.signal.aborted).toBe(true);

		staleGen.cleanup();
		activeGen.cleanup();
		currentLease.finish();
		staleLease.finish();
	});

	test("rejects stale epoch commit and markAttempted without mutating state", () => {
		const state = createTitleOwnershipState({
			maxRecentRawRequests: 4,
			timeoutMs: 5_000,
		});
		const apply = vi.fn();
		const persist = vi.fn();

		const initialLease = requireLease(state.beginInitial(undefined));

		// Advance epoch before commit.
		state.restore({
			branchState: INITIAL_STATE,
			titleInfo: { name: INITIAL_STATE.title, released: false },
			hasExistingRequests: true,
		});

		expect(
			initialLease.commit(
				{ name: undefined, released: false },
				INITIAL_STATE,
				apply,
			),
		).toBe(false);
		expect(apply).not.toHaveBeenCalled();

		const staleRefinement = requireLease(
			state.beginRefinement(INITIAL_STATE.title, {
				name: INITIAL_STATE.title,
				released: false,
			}),
		);
		state.restore({
			branchState: INITIAL_STATE,
			titleInfo: { name: INITIAL_STATE.title, released: false },
			hasExistingRequests: true,
		});
		expect(
			staleRefinement.markAttempted(
				{ name: INITIAL_STATE.title, released: false },
				persist,
			),
		).toBeUndefined();
		expect(persist).not.toHaveBeenCalled();

		const refinementLease = requireLease(
			state.beginRefinement(INITIAL_STATE.title, {
				name: INITIAL_STATE.title,
				released: false,
			}),
		);
		const consumed = refinementLease.markAttempted(
			{ name: INITIAL_STATE.title, released: false },
			persist,
		);
		expect(consumed).toEqual({ ...INITIAL_STATE, refinementAttempted: true });
		expect(persist).toHaveBeenCalledOnce();

		refinementLease.finish();
	});

	test("rejects already-finished leases in the same epoch and enforces shouldRunInitial and lazy titleInfo", () => {
		const state = createTitleOwnershipState({
			maxRecentRawRequests: 4,
			timeoutMs: 5_000,
		});

		// Resumed untitled sessions with existing requests are not eligible for initial naming.
		state.restore({
			branchState: undefined,
			titleInfo: { name: undefined, released: false },
			hasExistingRequests: true,
		});
		expect(state.shouldRunInitial()).toBe(false);

		state.restore({
			branchState: undefined,
			titleInfo: { name: undefined, released: false },
			hasExistingRequests: false,
		});
		expect(state.shouldRunInitial()).toBe(true);

		const abortedInitial = requireLease(state.beginInitial(undefined));
		expect(state.shouldRunInitial()).toBe(false);
		abortedInitial.finish();
		expect(state.shouldRunInitial()).toBe(true);

		// A newer lease in the same epoch owns the active slot; the finished lease cannot commit or abort it.
		const activeInitial = requireLease(state.beginInitial(undefined));
		abortedInitial.finish();
		expect(abortedInitial.canCommit({ name: undefined, released: false })).toBe(
			false,
		);
		expect(
			abortedInitial.commit(
				{ name: undefined, released: false },
				INITIAL_STATE,
				() => {
					throw new Error("finished lease must not commit");
				},
			),
		).toBe(false);
		const finishedGen = abortedInitial.createController(undefined);
		expect(finishedGen.controller.signal.aborted).toBe(true);
		finishedGen.cleanup();

		// Pre-aborted parent signal returns an already-aborted controller without scheduling a timer.
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const preAborted = new AbortController();
		preAborted.abort();
		const parentAbortedGen = activeInitial.createController(preAborted.signal);
		expect(parentAbortedGen.controller.signal.aborted).toBe(true);
		expect(setTimeoutSpy).not.toHaveBeenCalled();
		setTimeoutSpy.mockRestore();
		parentAbortedGen.cleanup();

		expect(
			activeInitial.commit(
				{ name: undefined, released: false },
				INITIAL_STATE,
				vi.fn(),
			),
		).toBe(true);
		activeInitial.finish();

		// Same-epoch finished refinement lease cannot markAttempted or commit while a newer refinement owns the slot.
		const firstRefinement = requireLease(
			state.beginRefinement(INITIAL_STATE.title, {
				name: INITIAL_STATE.title,
				released: false,
			}),
		);
		firstRefinement.finish();
		const secondRefinement = requireLease(
			state.beginRefinement(INITIAL_STATE.title, {
				name: INITIAL_STATE.title,
				released: false,
			}),
		);
		expect(
			firstRefinement.markAttempted(
				{ name: INITIAL_STATE.title, released: false },
				vi.fn(),
			),
		).toBeUndefined();
		expect(
			firstRefinement.commit(
				{ name: INITIAL_STATE.title, released: false },
				{ ...INITIAL_STATE, title: "Stale", phase: "refinement" },
				vi.fn(),
			),
		).toBe(false);
		secondRefinement.finish();

		// Lazy titleInfo getter is skipped when in-memory guards already reject.
		state.shutdown();
		expect(state.beginInitial(undefined)).toBeUndefined();
		const readTitleInfo = vi.fn(() => ({
			name: INITIAL_STATE.title,
			released: false,
		}));
		expect(activeInitial.canCommit(readTitleInfo)).toBe(false);
		expect(
			secondRefinement.commit(
				readTitleInfo,
				{ ...INITIAL_STATE, title: "Ignored", phase: "refinement" },
				vi.fn(),
			),
		).toBe(false);
		expect(readTitleInfo).not.toHaveBeenCalled();
	});
});
