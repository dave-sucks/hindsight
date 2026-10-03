/**
 * GET /api/runs/:id/status
 *
 * Is this run still going, and did it leave a thesis behind?
 *
 * The chat dispatches a thesis-writer and then sits there: the tool result is
 * written once, when the worker is spawned, and the run takes three or four
 * minutes. Nothing in the transcript ever changed — the row said "dispatched"
 * whether the writer was still reading filings, had finished, or had died.
 *
 * The caller polls this while the run is going and stops the moment it isn't.
 * Supabase Realtime would be the tidier shape, but `ResearchRun` is not in the
 * realtime publication and putting it there is a change to the production
 * database, so that is a decision for Dave rather than a thing this route
 * assumes.
 *
 * Scoped to the requesting user's account — a run id is a cuid, but that is
 * not an authorization story.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

export interface RunStatusResponse {
  /** PENDING | RUNNING | COMPLETE | FAILED */
  status: string;
  /** True once the run reached a terminal state — stop polling. */
  done: boolean;
  /** The thesis the run wrote, when it wrote one. */
  thesisId: string | null;
  ticker: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const run = await prisma.researchRun.findFirst({
    where: { id, accountId },
    select: {
      status: true,
      // A writer run leaves exactly one thesis; take the newest either way so
      // a re-run can't hand back a stale id.
      theses: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, ticker: true },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thesis = run.theses[0] ?? null;
  const body: RunStatusResponse = {
    status: run.status,
    done: run.status === "COMPLETE" || run.status === "FAILED",
    thesisId: thesis?.id ?? null,
    ticker: thesis?.ticker ?? null,
  };
  return NextResponse.json(body);
}
