/**
 * GET  /api/levels/analyst/:ownerId/triggers/reseed — the diff between the
 *      seat's playbook rules and what the analyst carries (DAV-280)
 * POST /api/levels/analyst/:ownerId/triggers/reseed — add the missing ones
 *
 * Analyst level only; the account is seeded by code at sign-up. Adds go
 * through addLevelTrigger, the same path the Triggers tab uses. Nothing is
 * removed or rewritten: a rule already in a bucket stays the analyst's.
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { parseLevelTriggers } from "@/lib/agent/triggers/load-levels";
import { addLevelTrigger } from "@/lib/actions/level-triggers";
import { statusForEditError, ThesisEditError } from "@/lib/actions/thesis-edit";
import { describeSeatRule, reseedDiff } from "@/lib/agent/triggers/seed-analyst";

async function load(level: string, ownerId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: new Response("Unauthorized", { status: 401 }) };
  const accountId = await getAccountId(user.id);
  if (!accountId) return { error: new Response("No account", { status: 403 }) };
  if (level !== "analyst") return { error: new Response("Re-seeding is for analysts", { status: 404 }) };
  const analyst = await prisma.agentConfig.findUnique({
    where: { id: ownerId },
    select: { id: true, name: true, setupIds: true, accountId: true, triggers: true },
  });
  if (!analyst) return { error: new Response("Not found", { status: 404 }) };
  if (analyst.accountId !== accountId) return { error: new Response("Forbidden", { status: 403 }) };
  const existing = parseLevelTriggers(analyst.triggers, `analyst=${ownerId}`);
  return { user, accountId, analyst, diff: reseedDiff(analyst.setupIds, existing) };
}

function shape(diff: ReturnType<typeof reseedDiff>) {
  return {
    setupName: diff.setupName,
    known: diff.toAdd.length + diff.present.length > 0,
    toAdd: diff.toAdd.map((t) => ({ id: t.id, text: describeSeatRule(t), rationale: t.rationale })),
    present: diff.present.map((p) => ({ text: describeSeatRule(p.existing) })),
    foreign: diff.foreign.map((t) => ({ text: describeSeatRule(t) })),
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ level: string; ownerId: string }> }) {
  const { level, ownerId } = await params;
  const r = await load(level, ownerId);
  if ("error" in r) return r.error;
  return Response.json(shape(r.diff));
}

export async function POST(_req: Request, { params }: { params: Promise<{ level: string; ownerId: string }> }) {
  const { level, ownerId } = await params;
  const r = await load(level, ownerId);
  if ("error" in r) return r.error;
  const role = await getUserRole(r.user.id, r.accountId);
  if (role === "VIEWER") return new Response("Forbidden", { status: 403 });
  const added: string[] = [];
  try {
    for (const t of r.diff.toAdd) {
      await addLevelTrigger(
        "ANALYST",
        ownerId,
        { action: t.action, predicate: t.predicate, fireMode: t.fireMode, rationale: t.rationale, cooldownDays: t.cooldownDays },
        { accountId: r.accountId, actorUserId: r.user.id },
      );
      added.push(describeSeatRule(t));
    }
  } catch (err) {
    if (err instanceof ThesisEditError) {
      return Response.json({ error: err.message, code: err.code, added }, { status: statusForEditError(err.code) });
    }
    console.error(`[level-trigger-reseed] ${ownerId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
  return Response.json({ ok: true, added });
}
