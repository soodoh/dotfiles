import { createClaudeOtelExtension } from "./otel-metrics";

export default createClaudeOtelExtension({
	providerName: "llm-hub",
});
