/**
 * PATCH  /api/levels/:level/:ownerId/triggers/:triggerId
 * DELETE /api/levels/:level/:ownerId/triggers/:triggerId
 *
 * The account/analyst counterparts of the thesis trigger routes. Same two
 * PATCH body shapes so the trigger popover is one component regardless of
 * which level it's editing:
 *   { value: number }                   → edit the value
 *   { fireMode: "TACTICAL" | "DIRECT" } → change how it fires
 *
 * Attempting either on a code DEFAULT rung 404s with an explanation —
 * those aren't stored anywhere, and the way to change one is to add a
 * rule at this level that overrides it.
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  deleteLevelTrigger,
  editLevelTriggerValue,
  setLevelTriggerFireMode,
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

  let body: { value?: unknown; fireMode?: unknown };
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
    if (typeof body.fireMode === "string") {
      if (body.fireMode !== "TACTICAL" && body.fireMode !== "DIRECT") {
        return new Response('`fireMode` must be "TACTICAL" or "DIRECT".', { status: 400 });
      }
      const trigger = await setLevelTriggerFireMode(
        auth.level,
        ownerId,
        triggerId,
        body.fireMode,
        ctx,
      );
      return Response.json({ ok: true, trigger });
    }

    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return new Response("Body must include a numeric `value` or a `fireMode` string.", {
        status: 400,
      });
    }
    const trigger = await editLevelTriggerValue(
      auth.level,
      ownerId,
      triggerId,
      body.value,
      ctx,
    );
    return Response.json({ ok: true, trigger });
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
