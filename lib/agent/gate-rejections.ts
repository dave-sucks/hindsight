/**
 * Gate-rejection telemetry (DAV-219).
 *
 * The write tools carry ~52 server-side rejection points, and until this
 * module every one of them reported to console.log and nowhere else. That
 * made "which rules ever fire" unanswerable — so every rule felt equally
 * load-bearing, and the gate count only ever went up. This is the receipt
 * printer: one row per refusal, written centrally from the defineTool()
 * wrapper so no gate needs its own wiring.
 *
 * Two exports:
 *
 *   detectGateRejection(data)  — PURE. Classifies a tool result's `data`
 *                                payload against the three rejection
 *                                protocols in use (see below). Unit-tested
 *                                without prisma.
 *   recordGateRejection(...)   — the write. Awaited (serverless: an
 *                                unawaited promise may be killed at
 *                                response end) but wrapped so a telemetry
 *                                failure can NEVER fail the tool call —
 *                                the rejection still reaches the agent
 *                                whether or not the row lands.
 *
 * The three protocols, as found (not designed — inventoried):
 *
 *   1. `{ ok: false, error: "<code>" }`          — update_thesis
 *   2. `{ status: "FAILED", note | message }`    — record_thesis, place_trade
 *   3. `{ success: false, status, message }`     — manage_position, close_position
 *
 * Deliberately NOT recorded: NO_POSITION / PROPOSED results (`success: true`
 * shapes) — a staged proposal or an idempotent no-op is the app working, not
 * a gate firing. The wrapper's own catch path IS
 * recorded, tagged `__exception__`, so "the agent gave up because the tool
 * crashed" and "because a gate refused" are distinguishable in one query.
 *
 * Since 2026-09-25 the table is also READ, because a refusal nobody acts on
 * is work that vanished: PLTR's buy was refused on 09-25, the run closed
 * out and ended COMPLETE, and nothing anywhere said the buy never happened.
 * Every row is now open until the same tool lands on the same stock (or
 * thesis) for the same analyst — `resolveGateRejections`, called from the
 * wrapper on every non-refused result. An open row is (1) put back to the
 * model before its run ends (the refusal retry in morning-research,
 * tactical-run and discovery-run), (2) written into the next daily run's
 * prompt as "Blocked last time", and (3) shown on the Activity feed. The
 * deletion-pass use above still stands.
 */

import { prisma } from "@/lib/prisma";
import type { ToolContext } from "./tool-context";
import { describeRefusalTool, type OpenRefusal } from "./refusal-carryover";

export { describeRefusalTool, type OpenRefusal };

export interface DetectedRejection {
  /** Machine code when the gate supplied one; null for note-only shapes. */
  gateCode: string | null;
}

/**
 * Classify a tool result's `data` payload. Returns null for anything that
 * isn't a refusal — including success shapes that merely carry a status
 * field (NO_POSITION, PROPOSED both ride `success: true`).
 */
export function detectGateRejection(data: unknown): DetectedRejection | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  // Protocol 1 — update_thesis / complete_run: { ok: false, error: code }
  if (d.ok === false) {
    return { gateCode: typeof d.error === "string" ? d.error : null };
  }
  // `ok: true` is an explicit success even if a status string rides along.
  if (d.ok === true) return null;

  // Protocol 3 — manage/close_position: { success: false, ... }.
  // `success: true` shapes (proposals, NO_POSITION no-ops) are the app
  // working, never a gate.
  if (d.success === true) return null;
  if (d.success === false) {
    const code =
      typeof d.error === "string"
        ? d.error
        : typeof d.status === "string" && d.status !== "FAILED"
          ? d.status
          : null;
    return { gateCode: code };
  }

  // Protocol 2 — record_thesis / place_trade: { status: "FAILED", note }.
  if (d.status === "FAILED") {
    return { gateCode: typeof d.error === "string" ? d.error : null };
  }

  return null;
}

/** The full reason text a refusal carried, if any (message | note). */
export function detailFromData(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const text = d.message ?? d.note;
  return typeof text === "string" && text.length > 0 ? text : null;
}

/**
 * Best-effort ticker extraction: the args (ticker | symbol), else the
 * summary's `$TICK` — update_thesis names a thesis id, not a ticker, and
 * its summaries read "Refused update on $GD — …".
 */
export function tickerFromArgs(args: unknown, summary?: string): string | null {
  if (typeof args === "object" && args !== null) {
    const a = args as Record<string, unknown>;
    const raw = a.ticker ?? a.symbol;
    if (typeof raw === "string" && raw.length > 0) return raw.toUpperCase().slice(0, 12);
  }
  const m = summary?.match(/\$([A-Z][A-Z0-9.\-]{0,11})\b/);
  return m ? m[1] : null;
}

/** The thesis a call named (thesis_id | thesisId), when it named one. */
export function thesisIdFromArgs(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const a = args as Record<string, unknown>;
  const raw = a.thesis_id ?? a.thesisId;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Persist one rejection row. Awaited by the wrapper; swallows its own
 * failures — telemetry must never turn a clean refusal into a crash.
 */
export async function recordGateRejection(opts: {
  tool: string;
  gateCode: string | null;
  summary: string;
  /** The full reason handed to the agent (data.message / data.note). */
  detail?: string | null;
  args: unknown;
  ctx: ToolContext;
}): Promise<void> {
  try {
    await prisma.gateRejection.create({
      data: {
        tool: opts.tool,
        gateCode: opts.gateCode,
        summary: opts.summary.slice(0, 500),
        detail: opts.detail ? opts.detail.slice(0, 2000) : null,
        ticker: tickerFromArgs(opts.args, opts.summary),
        thesisId: thesisIdFromArgs(opts.args),
        runId: opts.ctx.runId ?? null,
        analystId: opts.ctx.analystId ?? null,
        runMode: opts.ctx.runMode ?? null,
        // Open until the same tool lands on the stock or thesis — written
        // out loud so a row's state is never "unset".
        resolvedAt: null,
        resolvedBy: null,
      },
    });
  } catch (err) {
    console.warn(
      `[gate-rejections] write failed for ${opts.tool}/${opts.gateCode ?? "-"}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * A non-refused result answers every open refusal of the same tool on the
 * same stock or thesis for this analyst — this run's or an earlier one's.
 * `complete_run` has no stock: its refusals are answered by a landed
 * complete_run in the same run. Best-effort; never throws.
 */
export async function resolveGateRejections(opts: {
  tool: string;
  args: unknown;
  summary: string;
  ctx: ToolContext;
}): Promise<void> {
  try {
    const ticker = tickerFromArgs(opts.args, opts.summary);
    const thesisId = thesisIdFromArgs(opts.args);
    const subject: Array<Record<string, unknown>> = [];
    if (ticker) subject.push({ ticker });
    if (thesisId) subject.push({ thesisId });
    const where =
      opts.tool === "complete_run"
        ? { tool: opts.tool, runId: opts.ctx.runId ?? "", resolvedAt: null }
        : subject.length > 0 && opts.ctx.analystId
          ? { tool: opts.tool, analystId: opts.ctx.analystId, resolvedAt: null, OR: subject }
          : null;
    if (!where) return;
    await prisma.gateRejection.updateMany({
      where,
      data: { resolvedAt: new Date(), resolvedBy: `run:${opts.ctx.runId ?? "-"}` },
    });
  } catch (err) {
    console.warn(
      `[gate-rejections] resolve failed for ${opts.tool}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

const OPEN_SELECT = {
  id: true, tool: true, ticker: true, thesisId: true, summary: true, detail: true, runId: true, createdAt: true,
} as const;

/**
 * The refusals this run has not answered. `complete_run`'s are left out:
 * its refusal IS the loop (the model calls it again), and an unanswered
 * one already fails the run.
 */
export async function listOpenRefusalsForRun(runId: string): Promise<OpenRefusal[]> {
  try {
    return await prisma.gateRejection.findMany({
      where: { runId, resolvedAt: null, tool: { not: "complete_run" } },
      orderBy: { createdAt: "asc" },
      select: OPEN_SELECT,
    });
  } catch (err) {
    console.warn("[gate-rejections] listOpenRefusalsForRun failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** The analyst's open refusals from the last `days` — what the next run is told. */
export async function listOpenRefusalsForAnalyst(analystId: string, days = 7): Promise<OpenRefusal[]> {
  try {
    return await prisma.gateRejection.findMany({
      where: {
        analystId,
        resolvedAt: null,
        tool: { not: "complete_run" },
        createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
      },
      orderBy: { createdAt: "asc" },
      select: OPEN_SELECT,
    });
  } catch (err) {
    console.warn("[gate-rejections] listOpenRefusalsForAnalyst failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * The receipt for a run that ended with refusals still open — one RunEvent
 * the run page shows, so "the buy never happened" is on the run, not only
 * in a table. Best-effort.
 */
export async function recordOpenRefusalsEvent(runId: string, open: OpenRefusal[]): Promise<void> {
  if (open.length === 0) return;
  try {
    await prisma.runEvent.create({
      data: {
        runId,
        type: "action_blocked",
        title: `${open.length} refused ${open.length === 1 ? "call was" : "calls were"} never redone`,
        message: open
          .map((r) => `${describeRefusalTool(r.tool)}${r.ticker ? ` on $${r.ticker}` : ""}: ${r.detail ?? r.summary}`)
          .join("\n"),
        payload: {
          refusals: open.map((r) => ({ id: r.id, tool: r.tool, ticker: r.ticker, thesisId: r.thesisId, summary: r.summary })),
        } as object,
      },
    });
  } catch (err) {
    console.warn("[gate-rejections] recordOpenRefusalsEvent failed:", err instanceof Error ? err.message : err);
  }
}
