import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

type StatusUi = ExtensionContext["ui"];

const originalSetStatuses = new WeakMap<StatusUi, StatusUi["setStatus"]>();

function hidePiLensStatus(ui: StatusUi): void {
	const existingOriginal = originalSetStatuses.get(ui);
	if (existingOriginal) {
		existingOriginal("pi-lens-lsp", undefined);
		return;
	}

	const originalSetStatus = ui.setStatus.bind(ui);

	ui.setStatus = (id: string, text: string | undefined) => {
		if (id === "pi-lens-lsp") {
			originalSetStatus(id, undefined);
			return;
		}
		return originalSetStatus(id, text);
	};

	originalSetStatuses.set(ui, originalSetStatus);
	originalSetStatus("pi-lens-lsp", undefined);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		hidePiLensStatus(ctx.ui);
	});

	pi.on("tool_call", async (_event, ctx) => {
		hidePiLensStatus(ctx.ui);
		ctx.ui.setStatus("pi-lens-lsp", undefined);
	});

	pi.on("agent_end", async (_event, ctx) => {
		hidePiLensStatus(ctx.ui);
		ctx.ui.setStatus("pi-lens-lsp", undefined);
	});

	pi.on("turn_end", async (_event, ctx) => {
		hidePiLensStatus(ctx.ui);
		ctx.ui.setStatus("pi-lens-lsp", undefined);
	});
}
