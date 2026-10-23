/**
 * PATCH /api/theses/[id]/triggers/[triggerId]
 *
 * Principal edits one trigger: the trigger dialog's Save sends
 *   { replace: { action, predicate, fireMode? } } and the condition, action
 *   and fire mode are swapped in one write (applyTriggerReplace).
 * Keeps Thesis/Position in sync. Pure DB — no Alpaca, no approval.
 *
 * DELETE removes the trigger (applyTriggerDelete).
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { isFireMode } from "@/lib/agent/triggers/fire-mode";
import {
  applyTriggerReplace,
  type TriggerAddInput,
  applyTriggerDelete,
  statusForEditError,
  ThesisEditError,
} from "@/lib/actions/thesis-edit";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; triggerId: string }> },
) {
  const { id, triggerId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return new Response("No account", { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return new Response("Forbidden", { status: 403 });

  let body: { replace?: { action?: unknown; predicate?: unknown; fireMode?: unknown; trimPct?: unknown } };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const editCtx = { accountId, actorUserId: user.id };
  try {
    if (body.replace != null) {
      const r = body.replace;
      if (typeof r !== "object" || typeof r.action !== "string" || r.predicate == null || typeof r.predicate !== "object") {
        return new Response("`replace` must carry an `action` string and a `predicate` object.", { status: 400 });
      }
      if (r.fireMode != null && !isFireMode(r.fireMode)) return new Response('`fireMode` must be "DO_IT", "ASK_NOW" or "NEXT_MORNING".', { status: 400 });
      // Real validation (kind, ranges, the slot rule) happens inside applyTriggerReplace.
      const result = await applyTriggerReplace(
        id,
        triggerId,
        {
          action: r.action as TriggerAddInput["action"],
          predicate: r.predicate as TriggerAddInput["predicate"],
          fireMode: (r.fireMode ?? undefined) as TriggerAddInput["fireMode"],
          trimPct: typeof r.trimPct === "number" ? r.trimPct : undefined,
        },
        editCtx,
      );
      return Response.json(result);
    }

    return new Response("Body must carry `replace`: the trigger dialog's action, predicate and fire mode.", { status: 400 });
  } catch (err) {
    if (err instanceof ThesisEditError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusForEditError(err.code) },
      );
    }
    console.error(`[trigger-edit] unexpected error for ${id}/${triggerId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}

/**
 * DELETE /api/theses/[id]/triggers/[triggerId]
 *
 * Removes the trigger from the thesis's `triggers[]`. Leaves
 * Thesis.stopLoss/targetPrice intact (deleting the trigger removes the
 * automated action, not the documented level). Pure DB.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; triggerId: string }> },
) {
  const { id, triggerId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return new Response("No account", { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return new Response("Forbidden", { status: 403 });

  try {
    const result = await applyTriggerDelete(id, triggerId, {
      accountId,
      actorUserId: user.id,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof ThesisEditError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusForEditError(err.code) },
      );
    }
    console.error(`[trigger-delete] unexpected error for ${id}/${triggerId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
