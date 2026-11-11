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
 * page reads this when it opens, never as part of the page load. A run from
 * before the records existed has none, and says so.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_ROLE } from "@/lib/agent/run-requests";
import { decodeSteps, withRefsFilled, type RequestRecord, type SentRef } from "@/lib/agent/run-requests-format";
import { parseRecord, viewOfCall, type CallView, type SentPiece } from "@/lib/agent/run-requests-view";

export type RequestPieceSummary = Omit<SentPiece, "text">;
export type RequestCallSummary = Omit<CallView, "pieces"> & { id: string; pieces: RequestPieceSummary[] };

export interface RunRequestsResponse {
  /** PENDING | RUNNING | COMPLETE | FAILED */
  status: string;
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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const run = await prisma.researchRun.findFirst({
    where: { id, userId: user.id },
    select: {
      status: true,
      messages: {
        where: { role: REQUEST_ROLE },
        orderBy: { createdAt: "asc" },
        select: { id: true, content: true },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const records = run.messages
    .map((m) => ({ id: m.id, record: parseRecord(m.content) }))
    .filter((r): r is { id: string; record: RequestRecord } => r.record !== null);
  // A retry sends the main call's output back by id: every call's replies resolve every call's references.
  const refs: Record<string, SentRef> = Object.assign({}, ...records.map((r) => r.record.refs ?? {}));

  const url = new URL(req.url);
  const callId = url.searchParams.get("call");
  if (!callId) {
    const body: RunRequestsResponse = {
      status: run.status,
      calls: records.map(({ id: rowId, record }) => {
        const view = viewOfCall(record, refs);
        // The texts are fetched one at a time, when a piece is opened.
        const pieces = view.pieces.map(({ id: pid, kind, label, hint, chars, request, lastRequest }): RequestPieceSummary => ({ id: pid, kind, label, ...(hint ? { hint } : {}), chars, request, lastRequest }));
        return { ...view, id: rowId, pieces };
      }),
    };
    return NextResponse.json(body);
  }

  const hit = records.find((r) => r.id === callId);
  if (!hit) return NextResponse.json({ error: "No such call" }, { status: 404 });

  const pieceId = url.searchParams.get("piece");
  if (pieceId) {
    const piece = viewOfCall(hit.record, refs).pieces.find((p) => p.id === pieceId);
    if (!piece) return NextResponse.json({ error: "No such piece" }, { status: 404 });
    const body: RunRequestPieceResponse = { text: piece.text };
    return NextResponse.json(body);
  }

  const n = Number(url.searchParams.get("request"));
  const bodies = decodeSteps(hit.record);
  if (!Number.isInteger(n) || n < 1 || n > bodies.length) return NextResponse.json({ error: "No such request" }, { status: 404 });
  const sent = bodies[n - 1];
  const filled = withRefsFilled(sent, refs);
  const body: RunRequestBodyResponse = { request: n, of: bodies.length, body: sent ?? null, filled: filled.filled > 0 ? filled.body : null };
  return NextResponse.json(body);
}
