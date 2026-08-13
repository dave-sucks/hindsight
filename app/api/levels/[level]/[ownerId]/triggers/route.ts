/**
 * GET  /api/levels/:level/:ownerId/triggers  — the ladder in force at a level
 * POST /api/levels/:level/:ownerId/triggers  — add a standing rule there
 *
 * `:level` is "account" or "analyst"; `:ownerId` is the accountId or the
 * AgentConfig id. One route family for both so the trigger UI is a single
 * component pointed at a different base URL — the thesis sheet, the
 * analyst Triggers tab and /settings/triggers all render the same pills
 * from the same shape.
 *
 * GET returns the level's own rungs PLUS everything it inherits, each
 * tagged with `level` + `inherited` — resolved against an empty thesis
 * array, since there's no thesis in scope here. So the account page shows
 * its own rules solid and the code defaults dashed; the analyst page adds
 * the account's rules dashed in between.
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { resolveLadder } from "@/lib/agent/triggers/levels";
import { inheritableDefaultLadder } from "@/lib/agent/triggers/defaults";
import { parseLevelTriggers } from "@/lib/agent/triggers/load-levels";
import {
  addLevelTrigger,
  type WritableLevel,
} from "@/lib/actions/level-triggers";
import { statusForEditError, ThesisEditError } from "@/lib/actions/thesis-edit";
import type { TriggerAction, TriggerPredicate } from "@/lib/agent/triggers/types";

/** "account" | "analyst" → the cascade level. Anything else is a 404. */
function parseLevel(raw: string): WritableLevel | null {
  if (raw === "account") return "ACCOUNT";
  if (raw === "analyst") return "ANALYST";
  return null;
}

async function authorize(level: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: new Response("Unauthorized", { status: 401 }) };

  const accountId = await getAccountId(user.id);
  if (!accountId) return { error: new Response("No account", { status: 403 }) };

  const parsed = parseLevel(level);
  if (!parsed) return { error: new Response("Unknown level", { status: 404 }) };

  return { user, accountId, level: parsed };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ level: string; ownerId: string }> },
) {
  const { level, ownerId } = await params;
  const auth = await authorize(level);
  if (auth.error) return auth.error;
  const { accountId } = auth;

  // Both levels resolve the same way; they differ only in which stored
  // arrays sit above them.
  let own: unknown = [];
  let accountRungs: unknown = [];
  let ownerLabel = "";

  if (auth.level === "ACCOUNT") {
    if (ownerId !== accountId) return new Response("Forbidden", { status: 403 });
    const row = await prisma.account.findUnique({
      where: { id: accountId },
      select: { name: true, triggers: true },
    });
    if (!row) return new Response("Not found", { status: 404 });
    own = row.triggers;
    ownerLabel = row.name;
  } else {
    const analyst = await prisma.agentConfig.findUnique({
      where: { id: ownerId },
      select: { name: true, accountId: true, triggers: true },
    });
    if (!analyst) return new Response("Not found", { status: 404 });
    if (analyst.accountId !== accountId) {
      return new Response("Forbidden", { status: 403 });
    }
    own = analyst.triggers;
    ownerLabel = analyst.name;
    const acct = await prisma.account.findUnique({
      where: { id: accountId },
      select: { triggers: true },
    });
    accountRungs = acct?.triggers ?? [];
  }

  // No thesis in scope, so the thesis level is empty and the level being
  // viewed occupies the top slot. HELD/TARGET for the default ladder —
  // a standing rule is written for the general case, and the held-side
  // template is the one that carries the protection minimums.
  const resolved = resolveLadder({
    thesis: [],
    analyst:
      auth.level === "ANALYST" ? parseLevelTriggers(own, `analyst=${ownerId}`) : [],
    account:
      auth.level === "ACCOUNT"
        ? parseLevelTriggers(own, `account=${ownerId}`)
        : parseLevelTriggers(accountRungs, `account=${accountId}`),
    defaults: inheritableDefaultLadder("TARGET", "HELD"),
  });

  return Response.json({
    level: auth.level,
    ownerId,
    ownerLabel,
    triggers: resolved,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ level: string; ownerId: string }> },
) {
  const { level, ownerId } = await params;
  const auth = await authorize(level);
  if (auth.error) return auth.error;
  const { user, accountId } = auth;

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return new Response("Forbidden", { status: 403 });

  let body: {
    action?: unknown;
    predicate?: unknown;
    fireMode?: unknown;
    rationale?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (typeof body.action !== "string" || typeof body.predicate !== "object" || !body.predicate) {
    return new Response("Body must include `action` and `predicate`.", { status: 400 });
  }

  try {
    const created = await addLevelTrigger(
      auth.level,
      ownerId,
      {
        action: body.action as TriggerAction,
        predicate: body.predicate as TriggerPredicate,
        fireMode:
          body.fireMode === "TACTICAL" || body.fireMode === "DIRECT"
            ? body.fireMode
            : undefined,
        rationale: typeof body.rationale === "string" ? body.rationale : undefined,
      },
      { accountId, actorUserId: user.id },
    );
    return Response.json({ ok: true, trigger: created });
  } catch (err) {
    if (err instanceof ThesisEditError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusForEditError(err.code) },
      );
    }
    console.error(`[level-trigger-add] ${level}/${ownerId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
