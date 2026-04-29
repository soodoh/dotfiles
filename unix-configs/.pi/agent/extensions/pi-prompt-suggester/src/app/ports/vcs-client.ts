export interface VcsClient {
	getHeadCommit(): Promise<string | null>;
	getChangedFilesSinceCommit(commit: string): Promise<string[]>;
	getDiffSummary(paths: string[], maxChars: number): Promise<string | undefined>;
	getWorkingTreeStatus(): Promise<string[]>;
}
