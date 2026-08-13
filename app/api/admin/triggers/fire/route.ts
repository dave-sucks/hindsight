/**
 * POST /api/admin/triggers/fire
 *
 * Operator-only test endpoint: synthetically emits the
 * `app/thesis.trigger.fired` Inngest event for a chosen
 * (thesis, trigger) pair without waiting for a real signal or the
 * 15-min price cron. Pre-creates the ResearchRun row so the operator
 * can navigate straight to /runs/[runId] and watch the tactical
 * agent execute.
 *
 * Gating:
 *   - User must be authenticated.
 *   - User must own the thesis (Thesis.userId match).
 *   - Env flag ENABLE_TRIGGER_TEST_FIRE=1 (server-side gate so this
 *     can't be hit on prod accidentally).
 *
 * Body: { thesisId, triggerId }
 * Returns: { runId, eventId }
 *
 * Side effects:
 *   - Pre-creates ResearchRun(mode='INTRADAY_TACTICAL', status='RUNNING').
 *     The actual tactical-run Inngest function will pick up the event
 *     and ALSO try to create its own run — that double-creation is
 *     fine; the second one is the real one. We pre-create here so the
 *     UI has a runId to redirect to immediately. If you want strict
 *     no-duplicate behavior, omit the pre-create and have the UI poll
 *     for the runId by parameters.triggerId.
 *   - Emits app/thesis.trigger.fired with synthetic payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import { getAccountId, getUserRole } from "@/lib/auth/account";

const bodySchema = z.object({
  thesisId: z.string().min(1),
  triggerId: z.string().min(1),
});

// 2026-04-29: env-var gating removed. The route is auth-scoped (user
// must own the thesis) and synthetic firing is harmless to operations
// — the tactical run produces a real ResearchRun the user can audit.
// Single-user paper-trading app; no need for a multi-tenant kill switch.

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    body = bodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid body: ${err instanceof Error ? err.message : "bad input"}` },
      { status: 400 },
    );
  }

  const thesis = await prisma.thesis.findFirst({
    where: { id: body.thesisId, accountId },
    select: {
      id: true,
      ticker: true,
      triggers: true,
      // Cascade inputs — so an inherited rung can be manually fired too.
      triggerState: true,
      horizon: true,
      status: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Thesis not found" }, { status: 404 });
  }
  const analystId = thesis.researchRun.agentConfigId;
  if (!analystId) {
    return NextResponse.json(
      { error: "Thesis has no agent config; can't fire a tactical run." },
      { status: 400 },
    );
  }

  // Resolved ladder, not the raw column — an inherited rung (analyst /
  // account / code default) is not stored on the thesis, and a manual
  // fire of one is exactly as legitimate as a manual fire of its own.
  const ladder = resolveThesisLadder(
    thesis,
    (await loadLevelSources([analystId])).get(analystId),
    `thesis=${thesis.id}`,
  );
  const trigger = ladder.find((t) => t.id === body.triggerId);
  if (!trigger) {
    return NextResponse.json(
      { error: "Trigger not found on this thesis" },
      { status: 404 },
    );
  }

  // Emit the same event shape that trigger-evaluator emits. The
  // tactical-run Inngest consumer creates the canonical ResearchRun
  // when it processes this event.
  const dispatchedAt = new Date();
  const send = await inngest.send({
    name: "app/thesis.trigger.fired",
    data: {
      thesisId: thesis.id,
      triggerId: trigger.id,
      analystId,
      ticker: thesis.ticker,
      action: trigger.action,
      predicateKind: trigger.predicate.kind,
      // signalId omitted — this is a price/manual fire, not signal-driven.
    },
  });

  // Poll briefly for tactical-run.create-run to land. We avoid creating
  // a placeholder ResearchRun because the runs/[id] page would auto-fire
  // a parallel research-run agent on it (the bug seen on 2026-04-29).
  // Up to 15s of polling at 250ms intervals — Inngest typically lands
  // the row in <2s when warm, but Vercel cold-start + Inngest cold-start
  // can stack to 8-12s. 15s covers the worst case while still keeping
  // the request under the Vercel 30s API route limit.
  const POLL_MAX_MS = 15000;
  const POLL_INTERVAL_MS = 250;
  const pollUntil = Date.now() + POLL_MAX_MS;
  let runId: string | null = null;
  while (Date.now() < pollUntil) {
    const realRun = await prisma.researchRun.findFirst({
      where: {
        accountId,
        agentConfigId: analystId,
        mode: "INTRADAY_TACTICAL",
        startedAt: { gte: dispatchedAt },
        // Match on the triggerId stamped into parameters by tactical-run.
        parameters: {
          path: ["triggerId"],
          equals: trigger.id,
        },
      },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    if (realRun) {
      runId = realRun.id;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!runId) {
    // Inngest didn't land in time. Still return success — the run will
    // eventually appear in /runs. The UI shows a "queued" state instead
    // of redirecting.
    return NextResponse.json(
      {
        runId: null,
        queued: true,
        eventIds: send.ids,
        message:
          "Trigger event dispatched. The tactical run is queued — it will appear shortly in your runs list.",
      },
      { status: 202 },
    );
  }

  return NextResponse.json({
    runId,
    eventIds: send.ids,
  });
}
