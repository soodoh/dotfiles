import { readFile } from "node:fs/promises";

type ParsedLine = { indent: number; text: string };
type ParseResult = [unknown, number];

export async function loadYamlFile(path: string): Promise<unknown> {
	const raw = await readFile(path, "utf8");
	const trimmed = raw.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("["))
		return JSON.parse(raw);
	return parseYamlSubset(raw);
}

function parseYamlSubset(raw: string): unknown {
	const lines = raw
		.replaceAll("\t", "  ")
		.split(/\r?\n/)
		.map((line) => ({ indent: leadingSpaces(line), text: line.trimEnd() }))
		.filter(
			(line) => line.text.trim() && !line.text.trimStart().startsWith("#"),
		)
		.map((line) => ({ indent: line.indent, text: line.text.trimStart() }));
	if (!lines.length) return undefined;
	const [value] = parseBlock(lines, 0, lines[0].indent);
	return value;
}

function parseBlock(
	lines: ParsedLine[],
	index: number,
	indent: number,
): ParseResult {
	const line = lines[index];
	if (!line) return [undefined, index];
	if (line.indent !== indent)
		throw new Error(`Unexpected indentation at line ${index + 1}`);
	return line.text.startsWith("- ")
		? parseSequence(lines, index, indent)
		: parseMap(lines, index, indent);
}

function parseSequence(
	lines: ParsedLine[],
	index: number,
	indent: number,
): [unknown[], number] {
	const values: unknown[] = [];
	let cursor = index;
	while (cursor < lines.length) {
		const line = lines[cursor];
		if (!line || line.indent !== indent || !line.text.startsWith("- ")) break;
		const rest = line.text.slice(2).trim();
		cursor += 1;
		if (!rest) {
			if (lines[cursor] && lines[cursor].indent > indent) {
				const [nested, next] = parseBlock(lines, cursor, lines[cursor].indent);
				values.push(nested);
				cursor = next;
			} else {
				values.push(null);
			}
			continue;
		}
		if (splitKeyValue(rest)) {
			const [item, next] = parseMap(lines, cursor, indent + 2, rest);
			values.push(item);
			cursor = next;
			continue;
		}
		values.push(parseScalar(rest));
	}
	return [values, cursor];
}

function parseMap(
	lines: ParsedLine[],
	index: number,
	indent: number,
	initialEntry?: string,
): [Record<string, unknown>, number] {
	const value: Record<string, unknown> = {};
	let cursor = index;
	if (initialEntry)
		cursor = parseMapEntry(lines, cursor, indent, initialEntry, value);
	while (cursor < lines.length) {
		const line = lines[cursor];
		if (!line || line.indent < indent) break;
		if (line.indent > indent) break;
		if (line.text.startsWith("- ")) break;
		cursor = parseMapEntry(lines, cursor + 1, indent, line.text, value);
	}
	return [value, cursor];
}

function parseMapEntry(
	lines: ParsedLine[],
	index: number,
	indent: number,
	text: string,
	map: Record<string, unknown>,
): number {
	const pair = splitKeyValue(text);
	if (!pair) throw new Error(`Invalid YAML mapping entry: ${text}`);
	const [rawKey, rawValue] = pair;
	const key = unquote(rawKey.trim());
	const valueText = rawValue.trim();
	if (valueText === "|" || valueText === ">") {
		const [block, next] = parseBlockScalar(
			lines,
			index,
			indent,
			valueText === ">",
		);
		map[key] = block;
		return next;
	}
	if (!valueText) {
		const nextLine = lines[index];
		if (nextLine && nextLine.indent > indent) {
			const [nested, next] = parseBlock(lines, index, nextLine.indent);
			map[key] = nested;
			return next;
		}
		map[key] = {};
		return index;
	}
	map[key] = parseScalar(valueText);
	return index;
}

function parseBlockScalar(
	lines: ParsedLine[],
	index: number,
	parentIndent: number,
	folded: boolean,
): [string, number] {
	const collected: ParsedLine[] = [];
	let cursor = index;
	while (cursor < lines.length) {
		const line = lines[cursor];
		if (!line || line.indent <= parentIndent) break;
		collected.push(line);
		cursor += 1;
	}
	const baseIndent = Math.min(...collected.map((line) => line.indent));
	const text = collected
		.map(
			(line) => " ".repeat(Math.max(0, line.indent - baseIndent)) + line.text,
		)
		.join(folded ? " " : "\n");
	return [text ? `${text}\n` : "", cursor];
}

function parseScalar(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null" || trimmed === "~") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	)
		return unquote(trimmed);
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		const inner = trimmed.slice(1, -1).trim();
		return inner ? splitTopLevel(inner, ",").map(parseScalar) : [];
	}
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		const inner = trimmed.slice(1, -1).trim();
		const out: Record<string, unknown> = {};
		for (const entry of inner ? splitTopLevel(inner, ",") : []) {
			const pair = splitKeyValue(entry);
			if (!pair) throw new Error(`Invalid inline YAML object entry: ${entry}`);
			out[unquote(pair[0].trim())] = parseScalar(pair[1]);
		}
		return out;
	}
	return trimmed;
}

function splitKeyValue(text: string): [string, string] | undefined {
	const index = findTopLevel(text, ":");
	if (index < 0) return undefined;
	return [text.slice(0, index), text.slice(index + 1)];
}

function splitTopLevel(text: string, delimiter: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let depth = 0;
	let quote: string | undefined;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === quote && text[index - 1] !== "\\") quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "[" || char === "{") depth += 1;
		else if (char === "]" || char === "}") depth -= 1;
		else if (char === delimiter && depth === 0) {
			parts.push(text.slice(start, index).trim());
			start = index + 1;
		}
	}
	parts.push(text.slice(start).trim());
	return parts.filter(Boolean);
}

function findTopLevel(text: string, needle: string): number {
	let depth = 0;
	let quote: string | undefined;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === quote && text[index - 1] !== "\\") quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "[" || char === "{") depth += 1;
		else if (char === "]" || char === "}") depth -= 1;
		else if (char === needle && depth === 0) return index;
	}
	return -1;
}

function unquote(text: string): string {
	if (
		(text.startsWith('"') && text.endsWith('"')) ||
		(text.startsWith("'") && text.endsWith("'"))
	)
		return text.slice(1, -1);
	return text;
}

function leadingSpaces(text: string): number {
	return text.length - text.trimStart().length;
}
