/**
 * tool-error — turns a raw tool failure string into a structured, renderable
 * shape.
 *
 * Every failed tool call reaches the UI as a single opaque string. Three
 * producers, three very different shapes:
 *
 *   1. AI SDK input validation (Zod) — the tool never ran. assistant-ui maps
 *      `state:"output-error"` → `{ error: part.errorText }`, and errorText is
 *      the AI SDK's `InvalidToolInputError` message: a prose prefix, the whole
 *      input object inlined, then a JSON array of Zod issues.
 *   2. defineTool()'s catch — the tool ran and threw. errorText is just
 *      `err.message` inside an `{ ok:false, error }` envelope.
 *   3. Tool approval denial — `{ error: "Tool approval denied" }`.
 *
 * Shape 1 is the ugly one: a ~600-char wall that buries the actual issue
 * ("reason must be one of TARGET|STOP|MANUAL") behind the entire input echo.
 * This module pulls out the headline so the UI can show one line collapsed and
 * the structured detail on expand.
 *
 * Pure + string-only on purpose — no React, no DOM, unit-tested.
 */

export type ToolErrorKind =
  | "invalid_input" // Zod rejected the arguments; execute() never ran
  | "denied" // approval gate said no
  | "not_found" // model called a tool that doesn't exist in this mode
  | "execution"; // the tool ran and threw

export interface ToolErrorIssue {
  /** Dotted arg path, e.g. "reason" or "triggers.0.predicate" */
  path: string;
  message: string;
  /** Legal values, when the issue is an enum/literal mismatch */
  expected?: string[];
  received?: string;
}

export interface ParsedToolError {
  kind: ToolErrorKind;
  /** Short label for the collapsed row, e.g. "Invalid input". */
  title: string;
  /**
   * One-line human summary shown next to the title, already trimmed to
   * something that fits a chat row. e.g. `reason — expected TARGET, STOP or
   * MANUAL`.
   */
  detail: string;
  /** Structured issues (invalid_input only); empty otherwise. */
  issues: ToolErrorIssue[];
  /** The arguments the model sent, when they were recoverable. */
  input?: Record<string, unknown>;
  /** Always present — the untouched string, for the expanded JSON block. */
  raw: string;
}

const MAX_DETAIL = 140;

function truncate(s: string, max = MAX_DETAIL): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Scan forward from `start` (which must index a `{` or `[`) and return the
 * substring through its matching close bracket. String-aware so a brace inside
 * a rationale — and these rationales are paragraphs of prose — doesn't end the
 * scan early. Returns null if the bracket never closes (truncated stream).
 */
function extractBalanced(src: string, start: number): string | null {
  const open = src[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < src.length; i++) {
    const ch = src[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonAt(src: string, marker: string): unknown | undefined {
  const at = src.indexOf(marker);
  if (at === -1) return undefined;

  // Skip past the marker to the first bracket that follows it.
  let i = at + marker.length;
  while (i < src.length && src[i] !== "{" && src[i] !== "[") i++;
  if (i >= src.length) return undefined;

  const slice = extractBalanced(src, i);
  if (!slice) return undefined;
  try {
    return JSON.parse(slice);
  } catch {
    return undefined;
  }
}

/** Normalize one raw Zod issue object into our flatter shape. */
function toIssue(raw: unknown): ToolErrorIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message : null;
  if (!message) return null;

  const path = Array.isArray(r.path) ? r.path.join(".") : "";
  const values = Array.isArray(r.values)
    ? r.values.filter((v): v is string => typeof v === "string")
    : undefined;
  const expected =
    values && values.length > 0
      ? values
      : typeof r.expected === "string"
        ? [r.expected]
        : undefined;

  return {
    path,
    message,
    ...(expected ? { expected } : {}),
    ...(typeof r.received === "string" ? { received: r.received } : {}),
  };
}

/** "TARGET, STOP or MANUAL" — an enum list a human reads without squinting. */
function listValues(values: string[]): string {
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

function summarizeIssues(issues: ToolErrorIssue[]): string {
  if (issues.length === 0) return "";
  const [first] = issues;
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";

  const label = first.path || "input";
  if (first.expected && first.expected.length > 0) {
    const got = first.received ? `got ${first.received} — ` : "";
    return truncate(`${label} — ${got}expected ${listValues(first.expected)}${more}`);
  }
  return truncate(`${label} — ${first.message}${more}`);
}

/**
 * Parse a raw tool-error string into something renderable.
 *
 * `toolName` is only used to strip the redundant "for tool <name>" out of the
 * detail line — the row header already says which tool failed.
 */
export function parseToolError(rawError: unknown, toolName?: string): ParsedToolError {
  const raw =
    typeof rawError === "string"
      ? rawError
      : rawError == null
        ? "Unknown error"
        : (() => {
            try {
              return JSON.stringify(rawError);
            } catch {
              return String(rawError);
            }
          })();

  // ── 1. Zod input validation ──────────────────────────────────────────────
  // AI SDK: "Invalid input for tool X: Type validation failed: Value: {...}.
  //          Error message: [ {...issues} ]"
  if (/invalid input for tool|type validation failed/i.test(raw)) {
    const rawIssues = parseJsonAt(raw, "Error message:");
    const issues = (Array.isArray(rawIssues) ? rawIssues : [])
      .map(toIssue)
      .filter((i): i is ToolErrorIssue => i !== null);

    const parsedInput = parseJsonAt(raw, "Value:");
    const input =
      parsedInput && typeof parsedInput === "object" && !Array.isArray(parsedInput)
        ? (parsedInput as Record<string, unknown>)
        : undefined;

    return {
      kind: "invalid_input",
      title: "Invalid input",
      detail:
        summarizeIssues(issues) ||
        truncate(stripToolName(raw, toolName), 90),
      issues,
      ...(input ? { input } : {}),
      raw,
    };
  }

  // ── 2. Approval denial ───────────────────────────────────────────────────
  if (/tool approval denied|approval denied/i.test(raw)) {
    return {
      kind: "denied",
      title: "Denied",
      detail: truncate(raw),
      issues: [],
      raw,
    };
  }

  // ── 3. Unknown tool (wrong mode allowlist, usually) ──────────────────────
  if (/no such tool|unknown tool/i.test(raw)) {
    return {
      kind: "not_found",
      title: "Tool unavailable",
      detail: truncate(stripToolName(raw, toolName)),
      issues: [],
      raw,
    };
  }

  // ── 4. Anything the tool itself threw ────────────────────────────────────
  return {
    kind: "execution",
    title: "Failed",
    detail: truncate(stripToolName(raw, toolName)),
    issues: [],
    raw,
  };
}

/**
 * toolName is not always one of ours. On a NoSuchToolError it is whatever the
 * model emitted, so it can carry regex metacharacters — an unescaped one either
 * throws on RegExp construction or backtracks catastrophically. Escape before
 * interpolating.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripToolName(msg: string, toolName?: string): string {
  if (!toolName) return msg;
  const name = escapeRegex(toolName);
  return msg
    .replace(new RegExp(`\\s*for tool ${name}`, "gi"), "")
    .replace(new RegExp(`^${name}:\\s*`, "i"), "");
}

/**
 * Longest string value echoed back in the `input` block. Trade rationales run
 * to full paragraphs — echoing one verbatim buries the actual issue under a
 * wall of prose in a block meant to be scanned.
 */
const MAX_ECHOED_VALUE = 160;

function echoValue(v: unknown): unknown {
  if (typeof v === "string" && v.length > MAX_ECHOED_VALUE) {
    return `${v.slice(0, MAX_ECHOED_VALUE)}… (${v.length} chars)`;
  }
  return v;
}

/**
 * The object rendered in the expanded JSON block. Small and ordered — issue
 * first, input second — so the eye lands on the fix, not on the echo.
 */
export function toolErrorDetailJson(
  parsed: ParsedToolError,
  toolName: string,
): Record<string, unknown> {
  const issues = parsed.issues.map((i) => ({
    path: i.path,
    // "Invalid option: expected one of \"TARGET\"|\"STOP\"…" says nothing the
    // `expected` array doesn't say more legibly. Keep the prose only when it
    // is the only description of the problem.
    ...(i.expected ? { expected: i.expected } : { message: i.message }),
    ...(i.received ? { received: i.received } : {}),
  }));

  const input = parsed.input
    ? Object.fromEntries(Object.entries(parsed.input).map(([k, v]) => [k, echoValue(v)]))
    : undefined;

  return {
    tool: toolName,
    kind: parsed.kind,
    ...(issues.length > 0 ? { issues } : {}),
    ...(input ? { input } : {}),
    // The prose message is redundant once issues parse cleanly, so only carry
    // it when it's the only thing we have — truncated on the same rule as the
    // input echo, so a multi-KB stack trace can't become a wall of <pre>.
    ...(parsed.issues.length === 0 ? { message: echoValue(parsed.raw) } : {}),
  };
}
