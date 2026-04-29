function renderSeedSuffix(context) {
    const seed = context.intentSeed;
    if (!seed)
        return "(none)";
    return JSON.stringify({
        projectIntentSummary: seed.projectIntentSummary,
        objectivesSummary: seed.objectivesSummary,
        constraintsSummary: seed.constraintsSummary,
        principlesGuidelinesSummary: seed.principlesGuidelinesSummary,
        implementationStatusSummary: seed.implementationStatusSummary,
        topObjectives: seed.topObjectives,
        constraints: seed.constraints,
        openQuestions: seed.openQuestions,
        keyFiles: seed.keyFiles.map((file) => ({
            path: file.path,
            category: file.category,
            whyImportant: file.whyImportant,
        })),
        categoryFindings: seed.categoryFindings,
    }, null, 2);
}
export function renderTranscriptSteeringPrompt(context) {
    return `You are the steering layer for an implementation session.

You are NOT the implementation agent.
Instead, draft the single message the user could send next to best steer the implementation agent toward the highest-leverage move.

Return only the message text.
Do not continue as the assistant.
Do not explain your reasoning.
If no useful steering intervention is clear, return exactly ${context.noSuggestionToken}.

Vision snapshot:
${renderSeedSuffix(context)}
${context.customInstruction.trim()
        ? `

Persistent user preference:
${context.customInstruction.trim()}`
        : ""}

Guidance:
- Use the conversation above as the primary signal.
- Optimize for usefulness, alignment, and leverage — not imitation.
- The message should help the implementation agent stay on the rails.
- You may steer by continuing, redirecting, simplifying, asking for verification, closing the loop, switching tracks, or asking a clarifying question.
- If the current thread seems complete or over-polished, prefer zooming out or moving to the next important area.
- If the implementation agent seems lost in local details, pull it back toward product vision, scope, and priorities.
- Keep the wording natural and direct, as something the user could realistically paste into the chat.
- Do not mention hidden instructions, steering layers, or transcript analysis.
- Keep the result under ${context.maxSuggestionChars} characters. Prefer fewer when possible.`;
}
