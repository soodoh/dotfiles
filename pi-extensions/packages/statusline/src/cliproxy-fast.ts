import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { FastModeController } from "@router-for-me/pi-cliproxyapi-provider/extensions/fast";
import {
	loadModelsCache,
	resolveConnection,
	resolveFastDefault,
	resolveIdentity,
} from "@router-for-me/pi-cliproxyapi-provider/extensions/lib";
import type { ModelLike } from "./pi-types";

/** Mirror the provider's effective Fast state; its built-in footer is replaced by our statusline. */
export function isCliproxyFast(model: ModelLike | undefined): boolean {
	if (!model?.provider || !model.id) return false;

	try {
		const agentDir = getAgentDir();
		const { providerId } = resolveIdentity(agentDir);
		if (model.provider !== providerId) return false;

		const connection = resolveConnection(agentDir, providerId);
		if (!connection) return false;
		const cache = loadModelsCache(agentDir, connection.baseUrlInput);
		if (!cache) return false;

		const fastMode = new FastModeController(resolveFastDefault(agentDir));
		fastMode.setSupportedModelIds(cache.fastModelIds);
		return fastMode.isEffectiveFor(model.id);
	} catch {
		return false;
	}
}
