import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

// Only synthetic values reach this executable. It verifies the real subprocess
// channel without ever invoking an installed CLI or querying a live vault.
export function fakeBw(output = "[]") {
	const directory = mkdtempSync(join(tmpdir(), "pi-bw-test-"));
	const argsFile = join(directory, "args");
	const envFile = join(directory, "env");
	writeFileSync(
		join(directory, "bw"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$BW_TEST_ARGS"
printf '%s|%s\\n' "$BW_SESSION" "$BW_PI_UNLOCK_PASSWORD" >> "$BW_TEST_ENV"
printf '%s' "$BW_TEST_ERROR" >&2
if test "\${BW_TEST_EXIT:-0}" != 0; then exit "$BW_TEST_EXIT"; fi
case "$1" in
  unlock)
    test "$BW_PI_UNLOCK_PASSWORD" = "fixture-master" || exit 2
    test -z "$BW_SESSION" || exit 3
    printf '%s' "$BW_TEST_KEY"
    ;;
  list)
    test "$BW_SESSION" = "$BW_TEST_KEY" || exit 4
    test -z "$BW_PI_UNLOCK_PASSWORD" || exit 5
    printf '%s' "$BW_TEST_OUTPUT"
    ;;
  get)
    test "$2" = totp || exit 6
    test "$3" = 11111111-1111-1111-1111-111111111111 || exit 7
    test "$4" = --nointeraction || exit 8
    test "$BW_SESSION" = "$BW_TEST_KEY" || exit 4
    test -z "$BW_PI_UNLOCK_PASSWORD" || exit 5
    printf '%s' "$BW_TEST_TOTP"
    ;;
  *) exit 99 ;;
esac
`,
		{ mode: 0o700 },
	);
	vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
	vi.stubEnv("BW_SESSION", "fixture-inherited-session-must-be-ignored");
	vi.stubEnv("BW_TEST_ARGS", argsFile);
	vi.stubEnv("BW_TEST_ENV", envFile);
	vi.stubEnv("BW_TEST_KEY", "fixture-session-key");
	vi.stubEnv("BW_TEST_OUTPUT", output);
	vi.stubEnv("BW_TEST_TOTP", "000123");
	vi.stubEnv("BW_TEST_ERROR", "");
	vi.stubEnv("BW_TEST_EXIT", "0");
	return {
		directory,
		argsFile,
		envFile,
		dispose: () => rmSync(directory, { recursive: true, force: true }),
	};
}
