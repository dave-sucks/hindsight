/**
 * PATCH /api/theses/[id]/triggers/[triggerId]
 *
 * Principal edits one trigger from the trigger popover. Two body shapes:
 *   { value: number }                       → edit the trigger's value (applyTriggerValueEdit)
 *   { trailing: boolean, trailPct?: number } → switch the stop to/from trailing (applyTriggerTypeChange)
 * Both keep Thesis/Position in sync. Pure DB — no Alpaca, no approval.
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  applyTriggerValueEdit,
  applyTriggerTypeChange,
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

  let body: { value?: unknown; trailing?: unknown; trailPct?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // Ambiguous: a single PATCH is either a value edit or a type change, not both.
  if (typeof body.trailing === "boolean" && typeof body.value === "number") {
    return new Response("Send either `value` or `trailing`, not both.", { status: 400 });
  }

  const editCtx = { accountId, actorUserId: user.id };
  try {
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
      return new Response("Body must include a numeric `value` or a `trailing` boolean.", { status: 400 });
    }
    const result = await applyTriggerValueEdit(id, triggerId, body.value, editCtx);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ThesisEditError) {
      const status =
        err.code === "NOT_FOUND" ? 404 :
        err.code === "FORBIDDEN" ? 403 :
        err.code === "NOT_EDITABLE" ? 409 :
        400;
      return Response.json({ error: err.message, code: err.code }, { status });
    }
    console.error(`[trigger-edit] unexpected error for ${id}/${triggerId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
