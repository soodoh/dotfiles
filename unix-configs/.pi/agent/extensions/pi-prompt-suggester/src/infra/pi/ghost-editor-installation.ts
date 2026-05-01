import {
	CustomEditor,
	type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { GhostAcceptKey } from "../../config/types.js";
import {
	decorateGhostSuggestionEditor,
	type GhostSuggestionDecoratorOptions,
} from "./ghost-suggestion-decorator.js";

export interface GhostEditorInstallState {
	context: object;
	sessionFile: string | null;
}

interface GhostEditorDecoratorRuntimeOptions {
	getSuggestion: () => string | undefined;
	getSuggestionRevision: () => number;
	ghostAcceptKeys: readonly GhostAcceptKey[];
	ghostAcceptAndSendKeys: readonly GhostAcceptKey[];
}

type EditorFactory = (
	tui: ConstructorParameters<typeof CustomEditor>[0],
	theme: ConstructorParameters<typeof CustomEditor>[1],
	keybindings: ConstructorParameters<typeof CustomEditor>[2],
) => CustomEditor;

const ghostDecoratorRuntimeState = Symbol(
	"promptSuggesterGhostDecoratorRuntimeState",
);

class GhostDecoratorRuntime {
	private active = false;
	private installedDefaultEditor = false;
	private options: GhostEditorDecoratorRuntimeOptions | undefined;

	public constructor(
		private readonly originalSetEditorComponent: ExtensionContext["ui"]["setEditorComponent"],
	) {}

	public setOptions(options: GhostEditorDecoratorRuntimeOptions): void {
		this.options = options;
	}

	public activate(): void {
		this.active = true;
	}

	public ensureDefaultEditorInstalled(ctx: ExtensionContext): void {
		if (this.installedDefaultEditor) return;
		this.installedDefaultEditor = true;
		ctx.ui.setEditorComponent(undefined);
	}

	public setEditorComponent(factory: EditorFactory | undefined): void {
		this.originalSetEditorComponent(this.wrapFactory(factory));
	}

	private wrapFactory(factory: EditorFactory | undefined): EditorFactory {
		return (tui, theme, keybindings) => {
			const editor = factory
				? factory(tui, theme, keybindings)
				: new CustomEditor(tui, theme, keybindings);
			return decorateGhostSuggestionEditor(editor, () =>
				this.getDecoratorOptions(),
			);
		};
	}

	private getDecoratorOptions(): GhostSuggestionDecoratorOptions {
		const options = this.options;
		return {
			getSuggestion: () => options?.getSuggestion(),
			getSuggestionRevision: () => options?.getSuggestionRevision() ?? 0,
			ghostAcceptKeys: options?.ghostAcceptKeys ?? ["right"],
			ghostAcceptAndSendKeys: options?.ghostAcceptAndSendKeys ?? ["enter"],
			isActive: () => this.active,
		};
	}
}

function getRuntime(ctx: ExtensionContext): GhostDecoratorRuntime | undefined {
	const value = Reflect.get(ctx.ui, ghostDecoratorRuntimeState);
	return typeof value === "object" && value instanceof GhostDecoratorRuntime
		? value
		: undefined;
}

function ensureRuntime(ctx: ExtensionContext): GhostDecoratorRuntime {
	const existing = getRuntime(ctx);
	if (existing) return existing;

	const runtime = new GhostDecoratorRuntime(
		ctx.ui.setEditorComponent.bind(ctx.ui),
	);
	ctx.ui.setEditorComponent = (factory: EditorFactory | undefined) =>
		runtime.setEditorComponent(factory);
	Reflect.set(ctx.ui, ghostDecoratorRuntimeState, runtime);
	return runtime;
}

export function syncGhostEditorDecorator(params: {
	state: GhostEditorInstallState | undefined;
	context: ExtensionContext;
	sessionFile: string | null;
	options: GhostEditorDecoratorRuntimeOptions;
}): GhostEditorInstallState | undefined {
	const runtime = ensureRuntime(params.context);
	runtime.setOptions(params.options);
	runtime.activate();
	runtime.ensureDefaultEditorInstalled(params.context);
	return { context: params.context, sessionFile: params.sessionFile };
}
