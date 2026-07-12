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

export type AuthStorageLike = {
	get?(provider: string): AuthCredentialLike | undefined;
	list?(): string[];
	hasAuth?(provider: string): boolean;
	getOAuthProviders?(): { id: string; name?: string }[];
};

export type MaybePromise<T> = T | Promise<T>;

export type ModelRegistryLike = {
	getAll?(): ModelLike[];
	getAvailable?(): MaybePromise<ModelLike[]>;
	hasConfiguredAuth?(model: ModelLike): boolean;
	getProviderAuthStatus?(provider: string): {
		configured: boolean;
		source?: string;
		label?: string;
	};
	getProviderDisplayName?(provider: string): string;
	getApiKeyForProvider?(provider: string): Promise<string | undefined>;
	isUsingOAuth?(model: ModelLike): boolean;
	authStorage?: AuthStorageLike;
};

export type ProviderUsageContext = {
	model?: ModelLike;
	modelRegistry?: ModelRegistryLike;
};
