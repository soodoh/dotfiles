import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";

export const FIELD_SEPARATOR = "\u001f";
export const HEARTBEAT_SCHEMA_VERSION = 1;
export const HEARTBEAT_STALE_MS = 15_000;
export const HEARTBEAT_FUTURE_SKEW_MS = 5_000;
export const MAX_HEARTBEAT_BYTES = 32 * 1024;

const STATUS_PRIORITY = {
	ERROR: 0,
	WAITING: 1,
	STARTING: 2,
	THINKING: 2,
	TOOL: 2,
	UNKNOWN: 3,
	IDLE: 4,
};

const STATUS_STYLE = {
	ERROR: { color: "\u001b[38;2;247;118;142m", glyph: "!" },
	WAITING: { color: "\u001b[38;2;224;175;104m", glyph: "◐" },
	STARTING: { color: "\u001b[38;2;125;207;255m", glyph: "●" },
	THINKING: { color: "\u001b[38;2;122;162;247m", glyph: "●" },
	TOOL: { color: "\u001b[38;2;158;206;106m", glyph: "●" },
	UNKNOWN: { color: "\u001b[38;2;255;158;100m", glyph: "?" },
	IDLE: { color: "\u001b[38;2;86;95;137m", glyph: "○" },
};

const RESET = "\u001b[0m";
const TEXT = "\u001b[38;2;169;177;214m";
const BRANCH = "\u001b[38;2;122;162;247m";
const BRANCH_ICON = "\uF126";
const MUTED = "\u001b[38;2;86;95;137m";

const isRecord = (value) => typeof value === "object" && value !== null;
const isSafePositiveInteger = (value) =>
	Number.isSafeInteger(value) && value > 0;
const isFiniteTimestamp = (value) =>
	Number.isFinite(value) && value >= 0;

export const sanitizeDisplayText = (value, maxLength) => {
	if (typeof value !== "string") return "";
	return value
		.normalize("NFC")
		.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
};

export const normalizeTty = (value) =>
	sanitizeDisplayText(value, 160).replace(/^\/dev\//, "");

export const getStateDirectory = (
	environment = process.env,
	home = homedir(),
) => {
	const configured = environment.XDG_STATE_HOME;
	const stateHome = configured && isAbsolute(configured)
		? configured
		: join(home, ".local", "state");
	return join(stateHome, "pi", "tmux-sessions");
};

const parsePositiveInteger = (value) => {
	const parsed = Number(value);
	return isSafePositiveInteger(parsed) ? parsed : undefined;
};

const parseNonNegativeInteger = (value) => {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export const heartbeatServerKey = (socketPath, serverPid) =>
	createHash("sha256")
		.update(`${socketPath}\0${serverPid}`)
		.digest("hex")
		.slice(0, 16);

export const parseTmuxPanes = (output) => {
	const panes = [];
	for (const line of output.split("\n")) {
		if (!line.startsWith("%")) continue;
		const fields = line.split(FIELD_SEPARATOR);
		if (fields.length < 13) continue;
		const [
			paneId,
			panePidText,
			paneTty,
			sessionId,
			sessionName,
			windowId,
			windowIndexText,
			paneIndexText,
			currentCommand,
			socketPath,
			serverPidText,
			windowActivityText,
			...titleParts
		] = fields;
		const panePid = parsePositiveInteger(panePidText);
		const serverPid = parsePositiveInteger(serverPidText);
		const windowIndex = parseNonNegativeInteger(windowIndexText);
		const paneIndex = parseNonNegativeInteger(paneIndexText);
		const windowActivity = Number(windowActivityText);
		if (
			!/^%\d+$/.test(paneId) ||
			!/^\$\d+$/.test(sessionId) ||
			!/^@\d+$/.test(windowId) ||
			panePid === undefined ||
			serverPid === undefined ||
			windowIndex === undefined ||
			paneIndex === undefined
		) {
			continue;
		}
		panes.push({
			paneId,
			panePid,
			paneTty: sanitizeDisplayText(paneTty, 160),
			sessionId,
			sessionName: sanitizeDisplayText(sessionName, 80),
			windowId,
			windowIndex,
			paneIndex,
			currentCommand: sanitizeDisplayText(currentCommand, 80),
			socketPath: sanitizeDisplayText(socketPath, 1_024),
			serverPid,
			windowActivity: Number.isFinite(windowActivity)
				? windowActivity
				: 0,
			paneTitle: sanitizeDisplayText(titleParts.join(" "), 200),
		});
	}
	return panes;
};

export const parseProcessTable = (output) => {
	const processes = new Map();
	for (const line of output.split("\n")) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 10) continue;
		const pid = parsePositiveInteger(fields[0]);
		const parentPid = parsePositiveInteger(fields[1]);
		const processGroupId = parsePositiveInteger(fields[2]);
		const terminalProcessGroupId = parsePositiveInteger(fields[3]);
		const tty = fields[4];
		if (
			pid === undefined ||
			parentPid === undefined ||
			processGroupId === undefined ||
			terminalProcessGroupId === undefined ||
			!tty ||
			tty === "?" ||
			tty === "??"
		) {
			continue;
		}
		processes.set(pid, {
			pid,
			parentPid,
			processGroupId,
			terminalProcessGroupId,
			tty: sanitizeDisplayText(tty, 160),
			startedAt: fields.slice(5, 10).join(" "),
		});
	}
	return processes;
};

const isHeartbeat = (value) =>
	isRecord(value) &&
	value.schemaVersion === HEARTBEAT_SCHEMA_VERSION &&
	typeof value.instanceId === "string" &&
	isSafePositiveInteger(value.processPid) &&
	isSafePositiveInteger(value.processParentPid) &&
	isSafePositiveInteger(value.processGroupId) &&
	isSafePositiveInteger(value.terminalProcessGroupId) &&
	typeof value.processTty === "string" &&
	typeof value.processStartedAt === "string" &&
	typeof value.tmuxSocketPath === "string" &&
	isSafePositiveInteger(value.tmuxServerPid) &&
	typeof value.tmuxPaneId === "string" &&
	isSafePositiveInteger(value.tmuxPanePid) &&
	typeof value.tmuxPaneTty === "string" &&
	typeof value.piSessionId === "string" &&
	typeof value.cwd === "string" &&
	typeof value.state === "string" &&
	isFiniteTimestamp(value.stateChangedAt) &&
	(value.sessionStartedAt === undefined ||
		isFiniteTimestamp(value.sessionStartedAt)) &&
	isFiniteTimestamp(value.heartbeatAt);

const processIsDescendant = (processes, processId, ancestorId) => {
	let current = processes.get(processId);
	for (let depth = 0; current && depth < 64; depth += 1) {
		if (current.pid === ancestorId || current.parentPid === ancestorId) {
			return true;
		}
		if (current.parentPid <= 1 || current.parentPid === current.pid) return false;
		current = processes.get(current.parentPid);
	}
	return false;
};

export const heartbeatMatchesPane = (heartbeat, pane, processes) => {
	if (!isHeartbeat(heartbeat)) return false;
	const writer = processes.get(heartbeat.processPid);
	if (!writer) return false;
	return (
		heartbeat.tmuxPaneId === pane.paneId &&
		heartbeat.tmuxPanePid === pane.panePid &&
		heartbeat.tmuxPaneTty === pane.paneTty &&
		heartbeat.tmuxSocketPath === pane.socketPath &&
		heartbeat.tmuxServerPid === pane.serverPid &&
		heartbeat.processParentPid === writer.parentPid &&
		heartbeat.processGroupId === writer.processGroupId &&
		heartbeat.terminalProcessGroupId === writer.terminalProcessGroupId &&
		writer.processGroupId === writer.terminalProcessGroupId &&
		heartbeat.processStartedAt === writer.startedAt &&
		normalizeTty(heartbeat.processTty) === normalizeTty(writer.tty) &&
		normalizeTty(writer.tty) === normalizeTty(pane.paneTty) &&
		processIsDescendant(processes, writer.pid, pane.panePid)
	);
};

export const heartbeatIsFresh = (heartbeat, now) =>
	isHeartbeat(heartbeat) &&
	heartbeat.heartbeatAt <= now + HEARTBEAT_FUTURE_SKEW_MS &&
	now - heartbeat.heartbeatAt <= HEARTBEAT_STALE_MS;

const isKnownStatus = (status) =>
	Object.hasOwn(STATUS_PRIORITY, status) && status !== "UNKNOWN";
const looksLikePi = (pane) =>
	pane.currentCommand === "node" && pane.paneTitle.startsWith("π - ");


export const formatElapsed = (timestamp, now) => {
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
	if (seconds < 5) return "now";
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
};

const tmuxSessionName = (pane) =>
	sanitizeDisplayText(pane.sessionName, 80) || "tmux session";

const displayBranch = (branch) => (branch ? `${BRANCH_ICON} ${branch}` : "-");

const displayStatus = (status, toolName) => {
	if (status !== "TOOL") return status;
	const tool = sanitizeDisplayText(toolName, 18);
	return tool ? `TOOL ${tool}` : "TOOL";
};

const displayState = (row) =>
	`${displayStatus(row.status, row.toolName)} ${row.elapsed}`;

const renderRow = (row) => {
	const style = STATUS_STYLE[row.status];
	const sessionName = row.sessionName.padEnd(row.sessionNameColumnWidth);
	const branch = displayBranch(row.branch).padEnd(row.branchColumnWidth);
	const state = displayState(row).padEnd(row.stateColumnWidth);
	const ageGap = " ".repeat(row.sessionAgeGapWidth);
	const sessionAge = row.sessionAge.padStart(row.sessionAgeColumnWidth);
	return `${TEXT}${sessionName}${RESET} ${BRANCH}${branch}${RESET} ${style.color}${style.glyph} ${state}${RESET}${ageGap}${MUTED}${sessionAge}${RESET}`;
};

export const buildRows = ({
	panes,
	heartbeats,
	processes,
	now,
	branchForCwd = () => "",
	displayWidth,
}) => {
	const rows = [];
	for (const pane of panes) {
		const matches = heartbeats
			.filter((heartbeat) => heartbeatMatchesPane(heartbeat, pane, processes))
			.filter(
				(heartbeat) =>
				heartbeat.heartbeatAt <= now + HEARTBEAT_FUTURE_SKEW_MS,
			)
			.sort((left, right) => right.heartbeatAt - left.heartbeatAt);
		const heartbeat = matches[0];
		const fresh = heartbeat && heartbeatIsFresh(heartbeat, now);
		if (!heartbeat && !looksLikePi(pane)) continue;

		const status = fresh && isKnownStatus(heartbeat.state)
			? heartbeat.state
			: "UNKNOWN";
		const sessionName = tmuxSessionName(pane);
		const stateTimestamp = heartbeat
			? Math.min(now, heartbeat.stateChangedAt)
			: Math.min(now, pane.windowActivity * 1_000 || now);
		const sessionStartedAt = heartbeat?.sessionStartedAt;
		const sessionAge = isFiniteTimestamp(sessionStartedAt)
			? formatElapsed(Math.min(now, sessionStartedAt), now)
			: "-";
		const cwd = sanitizeDisplayText(heartbeat?.cwd, 512);
		const branch = sanitizeDisplayText(cwd ? branchForCwd(cwd) : "", 80);
		const row = {
			paneId: pane.paneId,
			sessionId: pane.sessionId,
			windowId: pane.windowId,
			status,
			toolName: fresh ? heartbeat.toolName : undefined,
			title: sessionName,
			tmuxTarget: `${pane.windowIndex}.${pane.paneIndex}`,
			sessionName,
			branch,
			stateTimestamp,
			elapsed: formatElapsed(stateTimestamp, now),
			sessionAge,
		};
		rows.push(row);
	}

	rows.sort((left, right) => {
		const priority = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
		if (priority !== 0) return priority;
		if (left.stateTimestamp !== right.stateTimestamp) {
			return right.stateTimestamp - left.stateTimestamp;
		}
		const leftTitle = left.title.toLowerCase();
		const rightTitle = right.title.toLowerCase();
		if (leftTitle !== rightTitle) return leftTitle < rightTitle ? -1 : 1;
		if (left.title !== right.title) return left.title < right.title ? -1 : 1;
		return Number(left.paneId.slice(1)) - Number(right.paneId.slice(1));
	});

	const sessionNameColumnWidth = rows.reduce(
		(width, row) => Math.max(width, row.sessionName.length),
		0,
	);
	const branchColumnWidth = rows.reduce(
		(width, row) => Math.max(width, displayBranch(row.branch).length),
		0,
	);
	const stateColumnWidth = rows.reduce(
		(width, row) => Math.max(width, displayState(row).length),
		0,
	);
	const sessionAgeColumnWidth = rows.reduce(
		(width, row) => Math.max(width, row.sessionAge.length),
		0,
	);
	const minimumRowWidth =
		sessionNameColumnWidth +
		1 +
		branchColumnWidth +
		1 +
		2 +
		stateColumnWidth +
		1 +
		sessionAgeColumnWidth;
	const sessionAgeGapWidth =
		Number.isSafeInteger(displayWidth) && displayWidth > 0
			? Math.max(1, displayWidth - minimumRowWidth + 1)
			: 1;
	for (const row of rows) {
		row.sessionNameColumnWidth = sessionNameColumnWidth;
		row.branchColumnWidth = branchColumnWidth;
		row.stateColumnWidth = stateColumnWidth;
		row.sessionAgeColumnWidth = sessionAgeColumnWidth;
		row.sessionAgeGapWidth = sessionAgeGapWidth;
	}
	return rows;
};

export const applyPaneOrder = (rows, paneIds) => {
	const order = new Map(paneIds.map((paneId, index) => [paneId, index]));
	return [...rows].sort((left, right) => {
		const leftIndex = order.get(left.paneId);
		const rightIndex = order.get(right.paneId);
		if (leftIndex === undefined && rightIndex === undefined) return 0;
		if (leftIndex === undefined) return 1;
		if (rightIndex === undefined) return -1;
		return leftIndex - rightIndex;
	});
};

export const rowToCandidate = (row) =>
	[row.paneId, row.sessionId, row.windowId, renderRow(row)].join("\t");

export const emptyCandidate = () =>
	["", "", "", `${MUTED}○ No live Pi panes on this tmux server${RESET}`].join(
		"\t",
	);
