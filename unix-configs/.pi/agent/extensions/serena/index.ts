import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerSerenaTools } from "./serena-tools";

export default function serenaExtension(pi: ExtensionAPI) {
  registerSerenaTools(pi);
}
