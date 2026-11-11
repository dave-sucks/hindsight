/**
 * GET /api/runs/:id/requests — what each model call of a run was sent.
 *
 *   (no query)                 every call of the run, with its pieces and their sizes
 *   ?call=<row id>&piece=<id>  one piece's full text, as sent
 *   ?call=<row id>&request=<n> request n (from 1) as sent, and, when it sent
 *                              the model's own earlier output back by id, the
 *                              same request with those filled in
 *
 * The records are written by run-requests.ts, one per model call. The run
 * page reads this when it opens, never as part of the page load. A piece or
 * a request reads its own call's row, and the earlier rows only when it needs
 * them: the call it is kept after, or the replies it refers back to.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_ROLE } from "@/lib/agent/run-requests";
import { decodeCalls, parseRecord, withRefsFilled, type RequestRecord, type SentRef } from "@/lib/agent/run-requests-format";
import { viewOfCall, type CallView, type SentPiece } from "@/lib/agent/run-requests-view";

export type RequestPieceSummary = Omit<SentPiece, "text">;
export type RequestCallSummary = Omit<CallView, "pieces"> & { id: string; pieces: RequestPieceSummary[] };

export interface RunRequestsResponse {
  /** PENDING | RUNNING | COMPLETE | FAILED */
  status: string;
  /** Kept no call, and no model call of any run was kept before it started: it is from before the records. */
  before: boolean;
  calls: RequestCallSummary[];
}

export interface RunRequestPieceResponse {
  text: string;
}

export interface RunRequestBodyResponse {
  request: number;
  of: number;
  body: unknown;
  /** The same request with each item reference filled in, marked as not sent; null when it sent none. */
  filled: unknown | null;
}

type Row = { id: string; record: RequestRecord };

function recordsOf(rows: ReadonlyArray<{ id: string; content: string }>): Row[] {
  return rows.flatMap((r) => {
    const record = parseRecord(r.content);
    return record ? [{ id: r.id, record }] : [];
  });
}

const timeEt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" });

/** Every reply's item ids, for reading `self`: a reply from another call says which call ("Main at 9:31:02 AM"), so its request number reads in that call. */
function refsFor(rows: readonly Row[], self: string): Record<string, SentRef> {
  const refs: Record<string, SentRef> = {};
  for (const r of rows) {
    for (const [id, ref] of Object.entries(r.record.refs ?? {})) refs[id] = r.id === self ? ref : { call: `${r.record.call} at ${timeEt(r.record.startedAt)} ET`, ...ref };
  }
  return refs;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const run = await prisma.researchRun.findFirst({ where: { id, userId: user.id }, select: { status: true, startedAt: true } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const callId = url.searchParams.get("call");
  if (!callId) {
    const rows = recordsOf(await prisma.runMessage.findMany({ where: { runId: id, role: REQUEST_ROLE }, orderBy: { createdAt: "asc" }, select: { id: true, content: true } }));
    const bodies = decodeCalls(rows);
    const calls = rows.flatMap(({ id: rowId, record }): RequestCallSummary[] => {
      const sent = bodies.get(rowId);
      if (!sent) return [];
      const view = viewOfCall(record, refsFor(rows, rowId), sent);
      // The texts are fetched one at a time, when a piece is opened.
      const pieces = view.pieces.map(({ id: pid, kind, label, hint, chars, request, lastRequest }): RequestPieceSummary => ({ id: pid, kind, label, ...(hint ? { hint } : {}), chars, request, lastRequest }));
      return [{ ...view, id: rowId, pieces }];
    });
    // A run that kept no call is from before the records only if no run had kept one when it started.
    const before = calls.length === 0 && !(await prisma.runMessage.findFirst({ where: { role: REQUEST_ROLE, createdAt: { lt: run.startedAt } }, select: { id: true } }));
    const body: RunRequestsResponse = { status: run.status, before, calls };
    return NextResponse.json(body);
  }

  // The call's own row; the earlier ones only when it is kept after one or refers back to their replies.
  const row = await prisma.runMessage.findFirst({ where: { id: callId, runId: id, role: REQUEST_ROLE }, select: { id: true, content: true, createdAt: true } });
  const hit = row && recordsOf([row])[0];
  if (!row || !hit) return NextResponse.json({ error: "No such call" }, { status: 404 });
  const needsEarlier = hit.record.after !== undefined || hit.record.provider === "openai.responses";
  const earlier = needsEarlier
    ? recordsOf(await prisma.runMessage.findMany({ where: { runId: id, role: REQUEST_ROLE, createdAt: { lte: row.createdAt }, id: { not: row.id } }, orderBy: { createdAt: "asc" }, select: { id: true, content: true } }))
    : [];
  const rows = [...earlier, hit];
  const bodies = decodeCalls(rows).get(hit.id);
  if (!bodies) return NextResponse.json({ error: "This call is kept after an earlier one that can't be read" }, { status: 404 });
  const refs = refsFor(rows, hit.id);

  const pieceId = url.searchParams.get("piece");
  if (pieceId) {
    const piece = viewOfCall(hit.record, refs, bodies).pieces.find((p) => p.id === pieceId);
    if (!piece) return NextResponse.json({ error: "No such piece" }, { status: 404 });
    const body: RunRequestPieceResponse = { text: piece.text };
    return NextResponse.json(body);
  }

  const n = Number(url.searchParams.get("request"));
  if (!Number.isInteger(n) || n < 1 || n > bodies.length) return NextResponse.json({ error: "No such request" }, { status: 404 });
  const sent = bodies[n - 1];
  const filled = withRefsFilled(sent, refs);
  const body: RunRequestBodyResponse = { request: n, of: bodies.length, body: sent ?? null, filled: filled.filled > 0 ? filled.body : null };
  return NextResponse.json(body);
}
