import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FastFooterController } from "@router-for-me/pi-cliproxyapi-provider/extensions/fast-footer";
import provider from "@router-for-me/pi-cliproxyapi-provider/extensions/index";
import {
	FAST_CHANGED_EVENT,
	FAST_READER_EVENT,
	type FastReader,
} from "../statusline/src/cliproxy-fast";

type FastModel = Parameters<FastFooterController["isProviderModel"]>[0];
type FastFooterReader =
	| { getServiceTierFor(model: FastModel): string | undefined }
	| { isEffectiveFor(model: FastModel): boolean };

function createFastReader(controller: FastFooterReader): FastReader {
	return (provider, modelId) => {
		const model = { provider, id: modelId, reasoning: false, contextWindow: 0 };
		// 1.5 replaced the boolean API with priority and ultrafast tiers.
		return "getServiceTierFor" in controller
			? controller.getServiceTierFor(model) !== undefined
			: controller.isEffectiveFor(model);
	};
}

/** Adapt the installed provider without copying or changing its request logic. */
export async function connectCliproxyFast(
	pi: ExtensionAPI,
	loadProvider: (pi: ExtensionAPI) => Promise<void> = provider,
): Promise<void> {
	// The provider creates a FastFooterController with its actual request controller.
	// Capture that instance while its factory runs so the reader sees changes
	// after commands, refreshes, and rollback. Restore the prototype immediately
	// so no other extension inherits our instrumentation.
	const originalRegister = FastFooterController.prototype.register;
	const captureRegister = function (
		this: FastFooterController,
		api: ExtensionAPI,
	) {
		FastFooterController.prototype.register = originalRegister;
		const result = originalRegister.call(this, api);
		pi.events.emit(FAST_READER_EVENT, createFastReader(this));
		return result;
	};
	FastFooterController.prototype.register = captureRegister;
	const wrappedPi = new Proxy(pi, {
		get(target, property, receiver) {
			if (property !== "registerCommand")
				return Reflect.get(target, property, receiver);
			return (
				name: string,
				options: Parameters<ExtensionAPI["registerCommand"]>[1],
			) => {
				if (name !== "fast" && name !== "ultrafast") {
					return target.registerCommand(name, options);
				}
				target.registerCommand(name, {
					...options,
					async handler(args, ctx) {
						try {
							await options.handler(args, ctx);
						} finally {
							// The provider handles refresh failures internally and may roll back.
							// Read the real controller after the command settles, not the config file.
							pi.events.emit(FAST_CHANGED_EVENT, undefined);
						}
					},
				});
			};
		},
	}) as ExtensionAPI;
	try {
		await loadProvider(wrappedPi);
	} finally {
		if (FastFooterController.prototype.register === captureRegister) {
			FastFooterController.prototype.register = originalRegister;
		}
	}
}

export default function cliproxyapi(pi: ExtensionAPI): Promise<void> {
	return connectCliproxyFast(pi);
}
