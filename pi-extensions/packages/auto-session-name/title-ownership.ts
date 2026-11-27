export type AutoTitleState = {
	title: string;
	originalRequest: string;
	phase: "initial" | "refinement";
	refinementAttempted: boolean;
	initialFallback: boolean;
	/** Explicit user ownership survives reload, even if the old title is restored. */
	ownershipReleased?: boolean;
};

export type AuthoritativeTitleInfo = {
	name: string | undefined;
	released: boolean;
};

export type TitleInfoSource =
	| AuthoritativeTitleInfo
	| (() => AuthoritativeTitleInfo);

const resolveTitleInfo = (source: TitleInfoSource): AuthoritativeTitleInfo =>
	typeof source === "function" ? source() : source;

export type GenerationController = {
	controller: AbortController;
	cleanup(): void;
};

export type GenerationLease = {
	createController(parentSignal: AbortSignal | undefined): GenerationController;
	finish(): void;
};

export type InitialGenerationLease = GenerationLease & {
	canCommit(titleInfo: TitleInfoSource): boolean;
	commit(
		titleInfo: TitleInfoSource,
		nextState: AutoTitleState,
		apply: (nextState: AutoTitleState) => void,
	): boolean;
};

export type RefinementGenerationLease = GenerationLease & {
	markAttempted(
		titleInfo: TitleInfoSource,
		persist: (nextState: AutoTitleState) => void,
	): AutoTitleState | undefined;
	commit(
		titleInfo: TitleInfoSource,
		nextState: AutoTitleState,
		apply: (nextState: AutoTitleState) => void,
	): boolean;
};

export type TitleOwnershipStateOptions = {
	maxRecentRawRequests: number;
	timeoutMs: number;
};

export type RestoreBranchOptions = {
	branchState: AutoTitleState | undefined;
	titleInfo: AuthoritativeTitleInfo;
	hasExistingRequests: boolean;
	allowExistingRequests?: boolean;
	activate?: boolean;
};

export function createTitleOwnershipState(options: TitleOwnershipStateOptions) {
	let active = true;
	let sessionEpoch = 0;
	let initialEligible = true;
	let firstRawRequest: string | undefined;
	let recentRawRequests: string[] = [];
	let autoTitleState: AutoTitleState | undefined;
	let ownsTitle = false;
	let manualOverride = false;
	let activeLease: GenerationLease | undefined;
	let requestController: AbortController | undefined;
	let applyingTitle: string | undefined;

	const abortRequest = () => {
		requestController?.abort();
		requestController = undefined;
	};

	const isLeaseCurrent = (lease: GenerationLease, epoch: number): boolean =>
		active && sessionEpoch === epoch && activeLease === lease;

	const canCommitInitial = (
		lease: GenerationLease,
		epoch: number,
		titleInfo: TitleInfoSource,
	): boolean => {
		if (!isLeaseCurrent(lease, epoch) || manualOverride || autoTitleState) {
			return false;
		}
		const info = resolveTitleInfo(titleInfo);
		return !info.name && !info.released;
	};

	const canCommitRefinement = (
		currentTitle: string,
		titleInfo: TitleInfoSource,
		lease?: { lease: GenerationLease; epoch: number },
	): boolean => {
		if (lease && !isLeaseCurrent(lease.lease, lease.epoch)) {
			return false;
		}
		if (
			!active ||
			!ownsTitle ||
			manualOverride ||
			autoTitleState?.title !== currentTitle
		) {
			return false;
		}
		const info = resolveTitleInfo(titleInfo);
		return info.name === currentTitle && !info.released;
	};

	const commitAutomaticTitle = (
		nextState: AutoTitleState,
		apply: (nextState: AutoTitleState) => void,
	) => {
		autoTitleState = nextState;
		ownsTitle = true;
		manualOverride = false;
		if (nextState.phase === "initial") initialEligible = false;
		applyingTitle = nextState.title;
		try {
			apply(nextState);
		} finally {
			applyingTitle = undefined;
		}
	};

	const createBaseLease = (
		epoch: number,
		leaseRef: () => GenerationLease,
	): GenerationLease => ({
		createController(parentSignal: AbortSignal | undefined) {
			const controller = new AbortController();
			if (
				!isLeaseCurrent(leaseRef(), epoch) ||
				manualOverride ||
				parentSignal?.aborted
			) {
				controller.abort();
				return {
					controller,
					cleanup() {},
				};
			}
			const abortFromParent = () => controller.abort();
			parentSignal?.addEventListener("abort", abortFromParent, {
				once: true,
			});
			requestController = controller;
			const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
			return {
				controller,
				cleanup() {
					clearTimeout(timeout);
					parentSignal?.removeEventListener("abort", abortFromParent);
					if (requestController === controller) requestController = undefined;
				},
			};
		},
		finish() {
			if (activeLease === leaseRef()) activeLease = undefined;
		},
	});

	const createInitialLease = (): InitialGenerationLease => {
		const epoch = sessionEpoch;
		const lease: InitialGenerationLease = {
			...createBaseLease(epoch, () => lease),
			canCommit(titleInfo) {
				return canCommitInitial(lease, epoch, titleInfo);
			},
			commit(titleInfo, nextState, apply) {
				if (!canCommitInitial(lease, epoch, titleInfo)) return false;
				commitAutomaticTitle(nextState, apply);
				return true;
			},
		};
		activeLease = lease;
		return lease;
	};

	const createRefinementLease = (
		currentTitle: string,
	): RefinementGenerationLease => {
		const epoch = sessionEpoch;
		const lease: RefinementGenerationLease = {
			...createBaseLease(epoch, () => lease),
			markAttempted(titleInfo, persist) {
				if (
					!autoTitleState ||
					!canCommitRefinement(currentTitle, titleInfo, { lease, epoch })
				) {
					return undefined;
				}
				const consumedState: AutoTitleState = {
					...autoTitleState,
					refinementAttempted: true,
				};
				autoTitleState = consumedState;
				persist(consumedState);
				return consumedState;
			},
			commit(titleInfo, nextState, apply) {
				if (!canCommitRefinement(currentTitle, titleInfo, { lease, epoch })) {
					return false;
				}
				commitAutomaticTitle(nextState, apply);
				return true;
			},
		};
		activeLease = lease;
		return lease;
	};

	return {
		restore({
			branchState,
			titleInfo,
			hasExistingRequests,
			allowExistingRequests = false,
			activate = false,
		}: RestoreBranchOptions) {
			if (activate) active = true;
			abortRequest();
			sessionEpoch += 1;
			firstRawRequest = undefined;
			recentRawRequests = [];
			activeLease = undefined;
			autoTitleState = branchState;
			ownsTitle = Boolean(
				autoTitleState &&
					!titleInfo.released &&
					!autoTitleState.ownershipReleased &&
					titleInfo.name === autoTitleState.title,
			);
			manualOverride = Boolean(
				titleInfo.released ||
					autoTitleState?.ownershipReleased ||
					(autoTitleState && titleInfo.name !== autoTitleState.title) ||
					(!autoTitleState && titleInfo.name),
			);
			initialEligible =
				!autoTitleState &&
				!manualOverride &&
				(allowExistingRequests || !hasExistingRequests);
		},

		recordInput(request: string) {
			firstRawRequest ??= request;
			recentRawRequests = [...recentRawRequests, request].slice(
				-options.maxRecentRawRequests,
			);
		},

		firstRequest(fallback: string | undefined): string | undefined {
			return firstRawRequest ?? fallback;
		},

		recentRequests(): readonly string[] {
			return recentRawRequests;
		},

		shouldRunInitial(): boolean {
			return (
				active &&
				initialEligible &&
				!activeLease &&
				!manualOverride &&
				!autoTitleState
			);
		},

		beginInitial(
			currentSessionName: string | undefined,
		): InitialGenerationLease | undefined {
			if (
				!active ||
				activeLease ||
				!initialEligible ||
				manualOverride ||
				autoTitleState ||
				currentSessionName
			) {
				return undefined;
			}
			return createInitialLease();
		},

		refinementCandidate(): AutoTitleState | undefined {
			if (!active || manualOverride || !autoTitleState || !ownsTitle) {
				return undefined;
			}
			return autoTitleState;
		},

		beginRefinement(
			currentTitle: string,
			titleInfo: TitleInfoSource,
		): RefinementGenerationLease | undefined {
			if (activeLease || !canCommitRefinement(currentTitle, titleInfo)) {
				return undefined;
			}
			return createRefinementLease(currentTitle);
		},

		handleSessionInfoChanged(
			name: string | undefined,
			persist: (nextState: AutoTitleState) => void,
		) {
			if (applyingTitle !== undefined && applyingTitle === name) return;
			if (autoTitleState && name !== autoTitleState.title) {
				ownsTitle = false;
				manualOverride = true;
				abortRequest();
				if (!autoTitleState.ownershipReleased) {
					const releasedState: AutoTitleState = {
						...autoTitleState,
						ownershipReleased: true,
					};
					autoTitleState = releasedState;
					persist(releasedState);
				}
				return;
			}
			if (!autoTitleState && name?.trim()) {
				manualOverride = true;
				abortRequest();
			}
		},

		shutdown() {
			active = false;
			sessionEpoch += 1;
			abortRequest();
			activeLease = undefined;
		},
	};
}
