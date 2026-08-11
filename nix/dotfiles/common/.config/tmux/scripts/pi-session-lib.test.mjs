import assert from "node:assert/strict";
import test from "node:test";
import {
	applyPaneOrder,
	buildRows,
	FIELD_SEPARATOR,
	formatElapsed,
	heartbeatMatchesPane,
	parseProcessTable,
	parseTmuxPanes,
	rowToCandidate,
	sanitizeDisplayText,
} from "./pi-session-lib.mjs";

const now = 1_000_000;

const pane = (overrides = {}) => ({
	paneId: "%1",
	panePid: 100,
	paneTty: "/dev/ttys001",
	sessionId: "$1",
	sessionName: "dotfiles",
	windowId: "@1",
	windowIndex: 1,
	paneIndex: 1,
	currentCommand: "node",
	socketPath: "/tmp/tmux-501/default",
	serverPid: 50,
	windowActivity: 900,
	paneTitle: "π - Define Pi session view",
	...overrides,
});

const processTable = () =>
	new Map([
		[
			100,
			{
				pid: 100,
				parentPid: 2,
				processGroupId: 200,
				terminalProcessGroupId: 200,
				tty: "ttys001",
				startedAt: "Wed Aug 5 09:59:00 2026",
			},
		],
		[
			200,
			{
				pid: 200,
				parentPid: 100,
				processGroupId: 200,
				terminalProcessGroupId: 200,
				tty: "ttys001",
				startedAt: "Wed Aug 5 10:00:00 2026",
			},
		],
	]);

const heartbeat = (overrides = {}) => ({
	schemaVersion: 1,
	instanceId: "instance-one",
	processPid: 200,
	processParentPid: 100,
	processGroupId: 200,
	terminalProcessGroupId: 200,
	processTty: "ttys001",
	processStartedAt: "Wed Aug 5 10:00:00 2026",
	tmuxSocketPath: "/tmp/tmux-501/default",
	tmuxServerPid: 50,
	tmuxPaneId: "%1",
	tmuxPanePid: 100,
	tmuxPaneTty: "/dev/ttys001",
	piSessionId: "pi-one",
	piSessionFile: "/home/user/.pi/session.jsonl",
	cwd: "/home/user/Projects/dotfiles",
	sessionName: "Define Pi session view",
	state: "WAITING",
	stateChangedAt: now - 120_000,
	heartbeatAt: now - 1_000,
	...overrides,
});

test("parses one machine-readable tmux snapshot and sanitizes its title", () => {
	const output = [
		"%1",
		"100",
		"/dev/ttys001",
		"$1",
		"dotfiles",
		"@1",
		"1",
		"1",
		"node",
		"/tmp/tmux-501/default",
		"50",
		"900",
		"π - title\twith\u001b]52;c;bad\u0007 controls",
	].join(FIELD_SEPARATOR);
	const panes = parseTmuxPanes(`${output}\nnot-a-pane\n`);
	assert.equal(panes.length, 1);
	assert.equal(panes[0].paneTitle, "π - title with ]52;c;bad controls");
});


test("accepts legal zero-based window and pane indexes", () => {
	const output = [
		"%1",
		"100",
		"/dev/ttys001",
		"$1",
		"default",
		"@1",
		"0",
		"0",
		"node",
		"/tmp/tmux-501/default",
		"50",
		"900",
		"π - zero indexes",
	].join(FIELD_SEPARATOR);
	const panes = parseTmuxPanes(`${output}\n`);
	assert.equal(panes.length, 1);
	assert.equal(panes[0].windowIndex, 0);
	assert.equal(panes[0].paneIndex, 0);
});

test("parses portable Darwin and Linux ps rows", () => {
	const processes = parseProcessTable(
		"200 100 200 200 ttys001 Wed Aug 5 10:00:00 2026\n" +
			"201 100 201 201 pts/4 Wed Aug 5 10:00:01 2026\n" +
			"202 100 202 0 ?? Wed Aug 5 10:00:02 2026\n",
	);
	assert.equal(processes.size, 2);
	assert.equal(processes.get(201).tty, "pts/4");
});

test("lists multiple sessions and multiple Pi panes in one session once", () => {
	const panes = [
		pane(),
		pane({
			paneId: "%2",
			panePid: 101,
			paneTty: "/dev/ttys002",
			windowId: "@2",
			paneIndex: 2,
			paneTitle: "π - Second pane",
		}),
		pane({
			paneId: "%3",
			panePid: 102,
			paneTty: "/dev/ttys003",
			sessionId: "$2",
			sessionName: "other",
			windowId: "@3",
			paneTitle: "π - Other session",
		}),
	];
	const rows = buildRows({ panes, heartbeats: [heartbeat()], processes: processTable(), now });
	assert.deepEqual(rows.map((row) => row.paneId).sort(), ["%1", "%2", "%3"]);
	assert.equal(new Set(rows.map((row) => row.paneId)).size, 3);
	assert.equal(rows.find((row) => row.paneId === "%2").status, "UNKNOWN");
});

test("omits a non-Pi Node pane and a heartbeat with no live pane", () => {
	const rows = buildRows({
		panes: [
			pane({ paneTitle: "node server" }),
			pane({
				paneId: "%2",
				currentCommand: "fish",
				paneTitle: "π - stale title",
			}),
		],
		heartbeats: [heartbeat({ tmuxPaneId: "%99" })],
		processes: processTable(),
		now,
	});
	assert.deepEqual(rows, []);
});

test("degrades stale or missing instrumentation to UNKNOWN", () => {
	const stale = buildRows({
		panes: [pane({ paneTitle: "ordinary title" })],
		heartbeats: [heartbeat({ heartbeatAt: now - 20_000 })],
		processes: processTable(),
		now,
	});
	assert.equal(stale[0].status, "UNKNOWN");

	const missing = buildRows({
		panes: [pane()],
		heartbeats: [],
		processes: new Map(),
		now,
	});
	assert.equal(missing[0].status, "UNKNOWN");
});

test("rejects identity mismatch and pane reuse", () => {
	const reusedPane = pane({ panePid: 999, paneTitle: "ordinary title" });
	assert.equal(heartbeatMatchesPane(heartbeat(), reusedPane, processTable()), false);
	assert.deepEqual(
		buildRows({
			panes: [reusedPane],
			heartbeats: [heartbeat()],
			processes: processTable(),
			now,
		}),
		[],
	);
});

test("ignores corrupt schemas and unsafe status names", () => {
	const rows = buildRows({
		panes: [pane()],
		heartbeats: [
			{ broken: true },
			heartbeat({ schemaVersion: 99 }),
			heartbeat({ state: "toString" }),
		],
		processes: processTable(),
		now,
	});
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, "UNKNOWN");
});

test("sorts attention tiers first and newest state first within a tier", () => {
	const panes = [
		pane({ paneId: "%1", paneTitle: "one" }),
		pane({ paneId: "%2", paneTitle: "two" }),
		pane({ paneId: "%3", paneTitle: "three" }),
		pane({ paneId: "%4", paneTitle: "four" }),
	];
	const heartbeats = [
		heartbeat({ state: "IDLE", tmuxPaneId: "%1" }),
		heartbeat({ state: "THINKING", tmuxPaneId: "%2" }),
		heartbeat({ state: "WAITING", tmuxPaneId: "%3" }),
		heartbeat({ state: "ERROR", tmuxPaneId: "%4" }),
	];
	const rows = buildRows({ panes, heartbeats, processes: processTable(), now });
	assert.deepEqual(rows.map((row) => row.status), ["ERROR", "WAITING", "THINKING", "IDLE"]);
});

test("keeps the opening pane order while appending newly discovered panes", () => {
	const refreshedRows = [
		{ paneId: "%1" },
		{ paneId: "%3" },
		{ paneId: "%2" },
	];
	const orderedRows = applyPaneOrder(refreshedRows, ["%2", "%1"]);
	assert.deepEqual(orderedRows.map((row) => row.paneId), ["%2", "%1", "%3"]);
});

test("keeps stable hidden targets separate from sanitized display text", () => {
	const rows = buildRows({
		panes: [pane({ paneTitle: "π - malicious\t$(touch /tmp/nope)\nname" })],
		heartbeats: [
			heartbeat({ sessionName: "bad\tname\u001b[31m", cwd: "/tmp/project\nname" }),
		],
		processes: processTable(),
		now,
	});
	const candidate = rowToCandidate(rows[0]);
	assert.equal(rows[0].title, "dotfiles");
	assert.equal(rows[0].tmuxTarget, "1.1");
	assert.equal(candidate.includes("bad name"), false);
	const [paneId, sessionId, windowId, display] = candidate.split("\t");
	assert.deepEqual([paneId, sessionId, windowId], ["%1", "$1", "@1"]);
	assert.equal(display.includes("\u001b]52"), false);
	assert.equal(sanitizeDisplayText("a\tb\nc", 20), "a b c");
});

test("formats elapsed state time compactly", () => {
	assert.equal(formatElapsed(now - 2_000, now), "now");
	assert.equal(formatElapsed(now - 8_000, now), "8s");
	assert.equal(formatElapsed(now - 120_000, now), "2m");
	assert.equal(formatElapsed(now - 7_200_000, now), "2h");
	assert.equal(formatElapsed(now - 172_800_000, now), "2d");
});
