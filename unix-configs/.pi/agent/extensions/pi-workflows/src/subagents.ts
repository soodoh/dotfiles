import { requestViaEvent } from "./pi-events.ts";
import type { ThinkingLevel } from "./workflow-types.ts";

const REQUEST = "subagent:slash:request";
const RESPONSE = "subagent:slash:response";

export interface SubagentRunParams { agent?: string; task?: string; tasks?: Array<{ agent: string; task: string; model?: string; thinking?: ThinkingLevel; output?: string | boolean }>; context?: "fresh" | "fork"; concurrency?: number; worktree?: boolean; model?: string; thinking?: ThinkingLevel; }

export function runSubagents(pi: any, params: SubagentRunParams, timeoutMs = 60 * 60 * 1000): Promise<any> {
  const requestId = `pwf-subagent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const off = pi.events.on(RESPONSE, (response: any) => {
      if (response?.requestId !== requestId) return;
      cleanup();
      if (response.isError) reject(new Error(response.errorText ?? "subagent run failed")); else resolve(response.result);
    });
    const timer = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for subagent response")); }, timeoutMs);
    function cleanup() { clearTimeout(timer); if (typeof off === "function") off(); }
    pi.events.emit(REQUEST, { requestId, params: { ...params, clarify: false, async: false } });
  });
}
