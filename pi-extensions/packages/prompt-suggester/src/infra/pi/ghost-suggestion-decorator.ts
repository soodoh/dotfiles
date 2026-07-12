import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import type { GhostAcceptKey } from "../../config/types";
import {
	matchesGhostAcceptKey,
	normalizeGhostAcceptAndSendKeys,
} from "./ghost-accept-keys";

const GHOST_COLOR = "\x1b[38;5;244m";
const RESET = "\x1b[0m";
const END_CURSOR = new RegExp(
	String.raw`(?:\x1b\[[0-9;]*m \x1b\[[0-9;]*m|█|▌|▋|▉|▓)`,
);
const ghostSuggestionDecoratorState = Symbol(
	"promptSuggesterGhostSuggestionDecoratorState",
);

export interface GhostSuggestionDecoratorOptions {
	getSuggestion: () => string | undefined;
	getSuggestionRevision: () => number;
	ghostAcceptKeys: readonly GhostAcceptKey[];
	ghostAcceptAndSendKeys: readonly GhostAcceptKey[];
	prefillOnlyWhenEditorEmpty: boolean;
	isActive: () => boolean;
}

interface GhostState {
	text: string;
	suggestion: string;
	suffix: string;
	suffixLines: string[];
	multiline: boolean;
}

export interface GhostDecoratableEditor {
	handleInput(data: string): void;
	render(width: number): string[];
	getText(): string;
	getCursor(): { line: number; col: number };
	setText(text: string): void;
	invalidate(): void;
}

class GhostSuggestionDecorator {
	private suppressGhost = false;
	private suppressGhostArmedByNonEmptyText = false;
	private lastSuggestion: string | undefined;
	private lastSuggestionRevision = -1;

	public constructor(
		private readonly editor: GhostDecoratableEditor,
		private readonly delegate: {
			handleInput(data: string): void;
			render(width: number): string[];
			setText(text: string): void;
		},
		private readonly getOptions: () => GhostSuggestionDecoratorOptions,
	) {}

	public handleInput(data: string): void {
		const options = this.getOptions();
		if (!options.isActive()) {
			this.delegate.handleInput(data);
			return;
		}

		const ghost = this.getGhostState(options);
		if (ghost && ghost.text.length === 0) {
			if (
				matchesGhostAcceptKey(
					data,
					normalizeGhostAcceptAndSendKeys(options.ghostAcceptAndSendKeys),
				)
			) {
				this.delegate.setText(ghost.suggestion);
				this.delegate.handleInput(data);
				return;
			}
			if (matchesGhostAcceptKey(data, options.ghostAcceptKeys)) {
				this.delegate.setText(ghost.suggestion);
				return;
			}
			this.suppressGhost = true;
			this.suppressGhostArmedByNonEmptyText = false;
			this.delegate.handleInput(data);
			this.updateGhostSuppressionLifecycle();
			return;
		}

		this.delegate.handleInput(data);
		this.updateGhostSuppressionLifecycle();
	}

	public setText(text: string): void {
		this.delegate.setText(text);
		this.updateGhostSuppressionLifecycle();
	}

	public render(width: number): string[] {
		const lines = this.delegate.render(width);
		const options = this.getOptions();
		if (!options.isActive()) return lines;

		const ghost = this.getGhostState(options);
		if (!ghost) return lines;
		if (lines.length < 3) return lines;

		const contentLineIndex = 1;
		const firstContentLine = lines[contentLineIndex];
		if (!firstContentLine) return lines;
		const match = END_CURSOR.exec(firstContentLine);
		if (!match) return lines;

		const cursorCol = visibleWidth(firstContentLine.slice(0, match.index));
		const lineStartCol = Math.max(0, cursorCol - visibleWidth(ghost.text));
		const firstSuffixLine = ghost.suffixLines[0] ?? "";
		const firstLineAvailable = Math.max(1, width - (cursorCol + 1));
		const firstSuffixWrapped = wrapTextWithAnsi(
			firstSuffixLine,
			firstLineAvailable,
		);
		const firstLineGhost = firstSuffixWrapped[0] ?? "";

		lines[contentLineIndex] = truncateToWidth(
			firstContentLine.replace(
				END_CURSOR,
				(cursor) => `${cursor}${GHOST_COLOR}${firstLineGhost}${RESET}`,
			),
			width,
			"",
		);

		const continuationLines: string[] = [];
		continuationLines.push(...firstSuffixWrapped.slice(1));
		for (let index = 1; index < ghost.suffixLines.length; index += 1) {
			continuationLines.push(
				...wrapTextWithAnsi(
					ghost.suffixLines[index] ?? "",
					Math.max(1, width - lineStartCol),
				),
			);
		}
		if (continuationLines.length === 0) return lines;

		for (let index = 0; index < continuationLines.length; index += 1) {
			const ghostLine = this.renderGhostLineAtColumn(
				continuationLines[index] ?? "",
				lineStartCol,
				width,
			);
			const targetIndex = contentLineIndex + 1 + index;
			const bottomBorderIndex = lines.length - 1;
			if (targetIndex < bottomBorderIndex) lines[targetIndex] = ghostLine;
			else lines.splice(bottomBorderIndex, 0, ghostLine);
		}

		return lines;
	}

	private renderGhostLineAtColumn(
		text: string,
		col: number,
		width: number,
	): string {
		const available = Math.max(0, width - col);
		const truncated = truncateToWidth(text, available, "");
		const used = col + visibleWidth(truncated);
		const padding = " ".repeat(Math.max(0, width - used));
		return truncateToWidth(
			`${" ".repeat(col)}${GHOST_COLOR}${truncated}${RESET}${padding}`,
			width,
			"",
		);
	}

	private updateGhostSuppressionLifecycle(): void {
		if (!this.suppressGhost) return;
		const text = this.editor.getText();
		if (text.length > 0) {
			this.suppressGhostArmedByNonEmptyText = true;
			return;
		}
		if (this.suppressGhostArmedByNonEmptyText) {
			this.suppressGhost = false;
			this.suppressGhostArmedByNonEmptyText = false;
		}
	}

	private getGhostState(
		options: GhostSuggestionDecoratorOptions,
	): GhostState | undefined {
		const revision = options.getSuggestionRevision();
		const suggestion = options.getSuggestion()?.trim();
		if (
			revision !== this.lastSuggestionRevision ||
			suggestion !== this.lastSuggestion
		) {
			this.lastSuggestionRevision = revision;
			this.lastSuggestion = suggestion;
			this.suppressGhost = false;
			this.suppressGhostArmedByNonEmptyText = false;
		}

		if (!suggestion || this.suppressGhost) return undefined;
		const text = this.editor.getText();
		if (options.prefillOnlyWhenEditorEmpty && text.length > 0) return undefined;
		const cursor = this.editor.getCursor();
		if (text.includes("\n")) return undefined;
		if (cursor.line !== 0 || cursor.col !== text.length) return undefined;
		if (!suggestion.startsWith(text)) return undefined;
		const suffix = suggestion.slice(text.length);
		if (!suffix) return undefined;
		const suffixLines = suffix.split("\n");
		const multiline = suffixLines.length > 1;
		if (multiline && text.length > 0) return undefined;
		return { text, suggestion, suffix, suffixLines, multiline };
	}
}

export function decorateGhostSuggestionEditor<
	TEditor extends GhostDecoratableEditor,
>(editor: TEditor, getOptions: () => GhostSuggestionDecoratorOptions): TEditor {
	if (Reflect.get(editor, ghostSuggestionDecoratorState) === true)
		return editor;

	const delegate = {
		handleInput: editor.handleInput.bind(editor),
		render: editor.render.bind(editor),
		setText: editor.setText.bind(editor),
	};
	const decorator = new GhostSuggestionDecorator(editor, delegate, getOptions);

	editor.handleInput = (data: string) => decorator.handleInput(data);
	editor.render = (width: number) => decorator.render(width);
	editor.setText = (text: string) => decorator.setText(text);
	Reflect.set(editor, ghostSuggestionDecoratorState, true);

	return editor;
}
