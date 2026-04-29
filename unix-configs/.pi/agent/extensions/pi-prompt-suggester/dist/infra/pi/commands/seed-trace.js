import { renderSeedTrace } from "./rendering.js";
import { parsePositiveInt } from "./shared.js";
export async function handleSeedTraceCommand(args, pi, composition) {
    const limit = parsePositiveInt(args.trim() || undefined, 240);
    const events = await composition.eventLog.readRecent(limit, { messagePrefix: "seeder." });
    pi.sendMessage({
        customType: "prompt-suggester-seed-trace",
        content: renderSeedTrace(events),
        display: true,
    }, { triggerTurn: false });
}
