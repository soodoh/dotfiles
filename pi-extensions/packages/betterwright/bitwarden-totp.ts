import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { totpCredentialId } from "./bitwarden-vault.ts";

const failure =
	"TOTP fill failed or its outcome is unknown. Check Bitwarden unlock, authenticator setup and CLI TOTP access. Inspect the visible outcome before retrying; input or submission may already have occurred.";

function validSelector(value: unknown): value is string {
	return (
		typeof value === "string" && Boolean(value.trim()) && value.length <= 1024
	);
}

/** Reuse the native login tool's browser, serialization and trusted worker fill. */
export function registerBitwardenTotpTool(
	pi: Pick<ExtensionAPI, "registerTool">,
	login: Pick<ToolDefinition, "execute">,
) {
	pi.registerTool({
		name: "browser_totp",
		label: "Bitwarden TOTP Fill",
		description:
			"Fill a numeric authenticator code from the selected matching Bitwarden login without revealing the code or seed. Requires the item's plain metadata id and an observed OTP input selector (CSS or current aria-ref). Submits only when an explicit submitSelector is supplied. Returns fill status, not authentication success. Never retries automatically.",
		promptSnippet:
			"Fill Bitwarden TOTP into an observed MFA field without exposing the code",
		promptGuidelines: [
			"Use browser_totp for Bitwarden-backed authenticator MFA after observing the OTP field and selecting the login from credentials.list(); never retrieve codes through shell tools or read the filled field.",
			"browser_totp accepts explicit OTP and optional submit selectors; do not read or capture the populated code. Verify the visible outcome separately and never blindly repeat an uncertain submission.",
		],
		parameters: Type.Object(
			{
				id: Type.String({ minLength: 1, maxLength: 64 }),
				selector: Type.String({ minLength: 1, maxLength: 1024 }),
				submitSelector: Type.Optional(
					Type.String({ minLength: 1, maxLength: 1024 }),
				),
			},
			{ additionalProperties: false },
		),
		async execute(callId, params, signal, _onUpdate, ctx) {
			const id = totpCredentialId(params.id);
			if (
				!validSelector(params.selector) ||
				(params.submitSelector !== undefined &&
					!validSelector(params.submitSelector))
			)
				throw new Error(
					"Explicit TOTP input and optional submit selectors are required.",
				);
			if (signal?.aborted) throw new Error("TOTP fill cancelled.");
			try {
				const result = await login.execute(
					callId,
					{
						id,
						passwordSelector: params.selector,
						...(params.submitSelector === undefined
							? {}
							: { submitSelector: params.submitSelector }),
					},
					signal,
					undefined,
					ctx,
				);
				// The upstream tool returns its envelope as JSON text. Never forward
				// arbitrary envelopes, diagnostics, pages, images or progress updates.
				const block = result.content.find((part) => part.type === "text");
				if (block?.type !== "text") throw new Error();
				const envelope = JSON.parse(block.text);
				if (
					signal?.aborted ||
					envelope?.ok !== true ||
					envelope.result?.id !== params.id ||
					!Array.isArray(envelope.result.filled) ||
					!envelope.result.filled.includes("password")
				)
					throw new Error();
				const status = {
					ok: true,
					id: params.id,
					filled: ["totp"],
					submitted: envelope.result.submitted === true,
				};
				return {
					content: [{ type: "text", text: JSON.stringify(status) }],
					details: status,
				};
			} catch {
				// Downstream errors can carry secret-bearing response bodies. Keep
				// only static text; cancellation cannot undo a committed submission.
				throw new Error(failure);
			}
		},
	});
}
