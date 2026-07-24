export type ModelLike = {
	name?: string;
	id?: string;
	contextWindow?: number;
	provider?: string;
	api?: string;
	baseUrl?: string;
};

export type AuthCredentialLike =
	| {
			type: "oauth";
			access?: string;
			refresh?: string;
	  }
	| { type: "api_key" };

export type MaybePromise<T> = T | Promise<T>;

export type ProviderLike = {
	name?: string;
	baseUrl?: string;
};

export type ProviderAuthLike = {
	auth?: {
		apiKey?: string;
	};
};

export type ModelRegistryLike = {
	getAll?(): ModelLike[];
	getAvailable?(): MaybePromise<ModelLike[]>;
	hasConfiguredAuth?(model: ModelLike): boolean;
	getProvider?(provider: string): ProviderLike | undefined;
	getProviderAuthStatus?(provider: string): {
		configured: boolean;
		source?: string;
		label?: string;
	};
	getProviderDisplayName?(provider: string): string;
	getProviderAuth?(provider: string): Promise<ProviderAuthLike | undefined>;
	getApiKeyForProvider?(provider: string): Promise<string | undefined>;
	isUsingOAuth?(model: ModelLike): boolean;
};

export type ProviderUsageContext = {
	model?: ModelLike;
	modelRegistry?: ModelRegistryLike;
	readStoredCredential?(providerId: string): AuthCredentialLike | undefined;
	reportError?(message: string): void;
};
