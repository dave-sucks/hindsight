/**
 * PATCH /api/theses/[id]/triggers/[triggerId]
 *
 * Principal edits one trigger from the trigger popover. Two body shapes:
 *   { value: number }                       → edit the trigger's value (applyTriggerValueEdit)
 *   { trailing: boolean, trailPct?: number } → switch the stop to/from trailing (applyTriggerTypeChange)
 *   { fireMode: "TACTICAL" | "DIRECT" }      → switch how the trigger fires (applyTriggerFireModeChange)
 * All keep Thesis/Position in sync. Pure DB — no Alpaca, no approval.
 *
 * DELETE removes the trigger (applyTriggerDelete).
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  applyTriggerValueEdit,
  applyTriggerTypeChange,
  applyTriggerFireModeChange,
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

  let body: {
    value?: unknown;
    trailing?: unknown;
    trailPct?: unknown;
    fireMode?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // Ambiguous: a single PATCH is exactly one of value-edit / type-change /
  // fire-mode change, never a mix.
  const shapeCount =
    (typeof body.value === "number" ? 1 : 0) +
    (typeof body.trailing === "boolean" ? 1 : 0) +
    (typeof body.fireMode === "string" ? 1 : 0);
  if (shapeCount > 1) {
    return new Response(
      "Send exactly one of `value`, `trailing`, or `fireMode`.",
      { status: 400 },
    );
  }

  const editCtx = { accountId, actorUserId: user.id };
  try {
    if (typeof body.fireMode === "string") {
      if (body.fireMode !== "TACTICAL" && body.fireMode !== "DIRECT") {
        return new Response('`fireMode` must be "TACTICAL" or "DIRECT".', { status: 400 });
      }
      const result = await applyTriggerFireModeChange(
        id,
        triggerId,
        body.fireMode,
        editCtx,
      );
      return Response.json(result);
    }

    if (typeof body.trailing === "boolean") {
      const trailPct =
        typeof body.trailPct === "number" && Number.isFinite(body.trailPct)
          ? body.trailPct
          : undefined;
      const result = await applyTriggerTypeChange(
        id,
        triggerId,
        { trailing: body.trailing, trailPct },
        editCtx,
      );
      return Response.json(result);
    }

    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return new Response(
        "Body must include a numeric `value`, a `trailing` boolean, or a `fireMode` string.",
        { status: 400 },
      );
    }
    const result = await applyTriggerValueEdit(id, triggerId, body.value, editCtx);
    return Response.json(result);
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
