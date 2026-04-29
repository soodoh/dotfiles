export type SteeringClassification =
	| "accepted_exact"
	| "accepted_edited"
	| "changed_course";

export interface SteeringEvent {
	turnId: string;
	suggestedPrompt: string;
	actualUserPrompt: string;
	classification: SteeringClassification;
	similarity: number;
	timestamp: string;
}

export interface SteeringSlice {
	recentChanged: SteeringEvent[];
}
