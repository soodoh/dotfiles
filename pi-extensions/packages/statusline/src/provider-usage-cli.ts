#!/usr/bin/env bun

import {
	ModelRuntime,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import type { ModelRegistryLike, ProviderUsageContext } from "./pi-types";
import {
	discoverProviderUsageTargetsAsync,
	formatProviderUsage,
	refreshProviderUsage,
} from "./provider-usage";

const modelRuntime = await ModelRuntime.create();
const modelRegistry: ModelRegistryLike = {
	getAll: () => [...modelRuntime.getModels()],
	getAvailable: async () => [...(await modelRuntime.getAvailable())],
	hasConfiguredAuth: (model) =>
		model.provider ? modelRuntime.hasConfiguredAuth(model.provider) : false,
	getProvider: (provider) => modelRuntime.getProvider(provider),
	getProviderAuthStatus: (provider) =>
		modelRuntime.getProviderAuthStatus(provider),
	getProviderDisplayName: (provider) =>
		modelRuntime.getProvider(provider)?.name ?? provider,
	getProviderAuth: (provider) => modelRuntime.getAuth(provider),
	getApiKeyForProvider: async (provider) =>
		(await modelRuntime.getAuth(provider))?.auth.apiKey,
	isUsingOAuth: (model) =>
		model.provider ? modelRuntime.isUsingOAuth(model.provider) : false,
};
const ctx: ProviderUsageContext = {
	modelRegistry,
	readStoredCredential,
	reportError: (message) =>
		process.stderr.write(`${new Date().toISOString()} ${message}\n`),
};
const targets = await discoverProviderUsageTargetsAsync(ctx);

await refreshProviderUsage(ctx, targets, () => {});

process.stdout.write(
	`${JSON.stringify({ text: formatProviderUsage(targets) ?? "" })}\n`,
);
