#!/usr/bin/env bun

import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import {
	discoverProviderUsageTargetsAsync,
	formatProviderUsage,
	refreshProviderUsage,
} from "./provider-usage";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const ctx = { modelRegistry };
const targets = await discoverProviderUsageTargetsAsync(ctx);

await refreshProviderUsage(ctx, targets, () => {});

process.stdout.write(
	`${JSON.stringify({ text: formatProviderUsage(targets) ?? "" })}\n`,
);
