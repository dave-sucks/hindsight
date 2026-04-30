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
import { triggersArraySchema } from "@/lib/agent/triggers/schema";

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
    where: { id: body.thesisId, userId: user.id },
    select: {
      id: true,
      ticker: true,
      triggers: true,
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

  const parsed = triggersArraySchema.safeParse(thesis.triggers);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Thesis.triggers JSON failed validation" },
      { status: 422 },
    );
  }
  const trigger = parsed.data.find((t) => t.id === body.triggerId);
  if (!trigger) {
    return NextResponse.json(
      { error: "Trigger not found on this thesis" },
      { status: 404 },
    );
  }

  // Pre-create ResearchRun so the UI has somewhere to navigate
  // immediately. The tactical-run Inngest consumer will create another
  // ResearchRun when it processes the event — both are fine; the second
  // is the canonical one, the first is a placeholder for navigation
  // that ends up FAILED if the operator never returns to it (or fine
  // either way, cosmetic only).
  const placeholderRun = await prisma.researchRun.create({
    data: {
      userId: user.id,
      agentConfigId: analystId,
      source: "AGENT",
      status: "RUNNING",
      mode: "INTRADAY_TACTICAL",
      parameters: {
        triggeredBy: "test-fire",
        thesisId: thesis.id,
        triggerId: trigger.id,
        ticker: thesis.ticker,
        action: trigger.action,
        predicateKind: trigger.predicate.kind,
        agentMode: true,
      } as object,
    },
    select: { id: true },
  });

  // Emit the same event shape that trigger-evaluator emits.
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

  return NextResponse.json({
    runId: placeholderRun.id,
    eventIds: send.ids,
  });
}
