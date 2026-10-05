/**
 * PATCH  /api/levels/:level/:ownerId/triggers/:triggerId
 * DELETE /api/levels/:level/:ownerId/triggers/:triggerId
 *
 * The account/analyst counterparts of the thesis trigger routes, so the
 * trigger dialog is one component whichever level it edits. PATCH takes
 *   { replace: { action, predicate, fireMode? } } → the trigger dialog's Save
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  deleteLevelTrigger,
  replaceLevelTrigger,
  type LevelTriggerAddInput,
  type WritableLevel,
} from "@/lib/actions/level-triggers";
import { statusForEditError, ThesisEditError } from "@/lib/actions/thesis-edit";

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

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return { error: new Response("Forbidden", { status: 403 }) };

  const parsed = parseLevel(level);
  if (!parsed) return { error: new Response("Unknown level", { status: 404 }) };

  return { user, accountId, level: parsed };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ level: string; ownerId: string; triggerId: string }> },
) {
  const { level, ownerId, triggerId } = await params;
  const auth = await authorize(level);
  if (auth.error) return auth.error;

  let body: {
    value?: unknown;
    fireMode?: unknown;
    part?: unknown;
    replace?: { action?: unknown; predicate?: unknown; fireMode?: unknown };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (typeof body.value === "number" && typeof body.fireMode === "string") {
    return new Response("Send either `value` or `fireMode`, not both.", { status: 400 });
  }

  const ctx = { accountId: auth.accountId, actorUserId: auth.user.id };
  try {
    if (body.replace != null) {
      const r = body.replace;
      if (typeof r !== "object" || typeof r.action !== "string" || r.predicate == null || typeof r.predicate !== "object") {
        return new Response("`replace` must carry an `action` string and a `predicate` object.", { status: 400 });
      }
      if (r.fireMode != null && r.fireMode !== "TACTICAL" && r.fireMode !== "DIRECT") {
        return new Response('`fireMode` must be "TACTICAL" or "DIRECT".', { status: 400 });
      }
      const trigger = await replaceLevelTrigger(
        auth.level,
        ownerId,
        triggerId,
        {
          action: r.action as LevelTriggerAddInput["action"],
          predicate: r.predicate as LevelTriggerAddInput["predicate"],
          fireMode: (r.fireMode ?? undefined) as LevelTriggerAddInput["fireMode"],
        },
        ctx,
      );
      return Response.json({ ok: true, trigger });
    }

    return new Response("Body must carry `replace`: the trigger dialog's action, predicate and fire mode.", { status: 400 });
  } catch (err) {
    if (err instanceof ThesisEditError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusForEditError(err.code) },
      );
    }
    console.error(`[level-trigger-edit] ${level}/${ownerId}/${triggerId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ level: string; ownerId: string; triggerId: string }> },
) {
  const { level, ownerId, triggerId } = await params;
  const auth = await authorize(level);
  if (auth.error) return auth.error;

  try {
    await deleteLevelTrigger(auth.level, ownerId, triggerId, {
      accountId: auth.accountId,
      actorUserId: auth.user.id,
    });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof ThesisEditError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusForEditError(err.code) },
      );
    }
    console.error(`[level-trigger-delete] ${level}/${ownerId}/${triggerId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
