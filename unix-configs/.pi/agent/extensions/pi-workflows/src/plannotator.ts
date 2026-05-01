import { readFile } from "node:fs/promises";
import { requestViaEvent, waitForEvent } from "./pi-events.ts";

const REQUEST = "plannotator:request";
const RESULT = "plannotator:review-result";

export interface PlanReviewResult { approved: boolean; feedback?: string; savedPath?: string; reviewId: string; }

export async function reviewPlanWithPlannotator(pi: any, filePath: string, planContent?: string): Promise<PlanReviewResult> {
  const content = planContent ?? await readFile(filePath, "utf8");
  const response = await requestViaEvent<any, any>(pi.events, REQUEST, {
    action: "plan-review",
    payload: { planContent: content, planFilePath: filePath, origin: "pi-workflows" },
  }, 10_000);
  if (response?.status !== "handled" || response?.result?.status !== "pending") throw new Error(response?.error ?? "Plannotator plan-review unavailable");
  const reviewId = response.result.reviewId as string;
  const result = await waitForEvent<any>(pi.events, RESULT, (event) => event?.reviewId === reviewId);
  return { reviewId, approved: Boolean(result.approved), feedback: result.feedback, savedPath: result.savedPath };
}
