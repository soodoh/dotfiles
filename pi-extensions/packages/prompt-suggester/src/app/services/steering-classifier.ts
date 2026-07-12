import type { PromptSuggesterConfig } from "../../config/types";
import type { SteeringClassification } from "../../domain/steering";

interface SteeringClassificationResult {
	classification: SteeringClassification;
	similarity: number;
}

const MAX_SEQUENCE_SIMILARITY_CHARS = 2000;

function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function tokenSet(value: string): Set<string> {
	return new Set(value.split(/[^a-z0-9]+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let intersection = 0;
	for (const value of a) if (b.has(value)) intersection += 1;
	const union = new Set([...a, ...b]).size;
	return union === 0 ? 0 : intersection / union;
}

function boundedSequenceInput(value: string): string {
	if (value.length <= MAX_SEQUENCE_SIMILARITY_CHARS) return value;
	return value.slice(0, MAX_SEQUENCE_SIMILARITY_CHARS);
}

function lcsLength(a: string, b: string): number {
	let previous = new Array<number>(b.length + 1).fill(0);
	let current = new Array<number>(b.length + 1).fill(0);
	for (let i = 1; i <= a.length; i += 1) {
		for (let j = 1; j <= b.length; j += 1) {
			current[j] =
				a[i - 1] === b[j - 1]
					? previous[j - 1] + 1
					: Math.max(previous[j], current[j - 1]);
		}
		const nextPrevious = previous;
		previous = current;
		current = nextPrevious.fill(0);
	}
	return previous[b.length] ?? 0;
}

function sequenceSimilarity(a: string, b: string): number {
	if (!a && !b) return 1;
	const boundedA = boundedSequenceInput(a);
	const boundedB = boundedSequenceInput(b);
	const lcs = lcsLength(boundedA, boundedB);
	return (2 * lcs) / Math.max(1, boundedA.length + boundedB.length);
}

export class SteeringClassifier {
	public constructor(private readonly config: PromptSuggesterConfig) {}

	public classify(
		suggestedPrompt: string,
		actualUserPrompt: string,
	): SteeringClassificationResult {
		const suggested = normalizeText(suggestedPrompt);
		const actual = normalizeText(actualUserPrompt);
		if (suggested === actual) {
			return {
				classification: "accepted_exact",
				similarity: 1,
			};
		}

		const similarity =
			(jaccard(tokenSet(suggested), tokenSet(actual)) +
				sequenceSimilarity(suggested, actual)) /
			2;
		return {
			classification:
				similarity >= this.config.steering.acceptedThreshold
					? "accepted_edited"
					: "changed_course",
			similarity,
		};
	}
}
