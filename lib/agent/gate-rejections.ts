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
 * Deliberately NOT recorded: SUPPRESSED / NO_POSITION / PROPOSED results
 * (`success: true` shapes) — a decline-cooldown hold or an idempotent no-op
 * is the app working, not a gate firing. The wrapper's own catch path IS
 * recorded, tagged `__exception__`, so "the agent gave up because the tool
 * crashed" and "because a gate refused" are distinguishable in one query.
 *
 * Nothing reads this table to make a decision. It exists so the next
 * deletion pass over the big tool files runs on evidence — a rule that
 * hasn't fired in weeks is a deletion candidate with a receipt; a rule
 * firing constantly is a missing input wearing a gate costume (the DAV-210
 * standing rule, finally applicable).
 */

import { prisma } from "@/lib/prisma";
import type { ToolContext } from "./tool-context";

export interface DetectedRejection {
  /** Machine code when the gate supplied one; null for note-only shapes. */
  gateCode: string | null;
}

/**
 * Classify a tool result's `data` payload. Returns null for anything that
 * isn't a refusal — including success shapes that merely carry a status
 * field (SUPPRESSED, NO_POSITION, PROPOSED all ride `success: true`).
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
  // `success: true` shapes (SUPPRESSED cooldown holds, NO_POSITION no-ops)
  // are the app working, never a gate.
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

/** Best-effort ticker extraction from tool args (ticker | symbol). */
export function tickerFromArgs(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const a = args as Record<string, unknown>;
  const raw = a.ticker ?? a.symbol;
  return typeof raw === "string" && raw.length > 0
    ? raw.toUpperCase().slice(0, 12)
    : null;
}

/**
 * Persist one rejection row. Awaited by the wrapper; swallows its own
 * failures — telemetry must never turn a clean refusal into a crash.
 */
export async function recordGateRejection(opts: {
  tool: string;
  gateCode: string | null;
  summary: string;
  args: unknown;
  ctx: ToolContext;
}): Promise<void> {
  try {
    await prisma.gateRejection.create({
      data: {
        tool: opts.tool,
        gateCode: opts.gateCode,
        summary: opts.summary.slice(0, 500),
        ticker: tickerFromArgs(opts.args),
        runId: opts.ctx.runId ?? null,
        analystId: opts.ctx.analystId ?? null,
        runMode: opts.ctx.runMode ?? null,
      },
    });
  } catch (err) {
    console.warn(
      `[gate-rejections] write failed for ${opts.tool}/${opts.gateCode ?? "-"}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
