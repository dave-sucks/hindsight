/**
 * PATCH /api/theses/[id]/triggers/[triggerId]
 *
 * Principal edits one trigger's value from the trigger popover. Routes through
 * applyTriggerValueEdit, which updates the value in the thesis triggers array
 * and keeps Thesis/Position stop-target in sync when it's the canonical price
 * trigger. Pure DB — no Alpaca, no approval.
 *
 * Body: { value: number }
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { applyTriggerValueEdit, ThesisEditError } from "@/lib/actions/thesis-edit";

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

  let value: unknown;
  try {
    value = ((await req.json()) as { value?: unknown })?.value;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (typeof value !== "number") {
    return new Response("Body must include a numeric `value`.", { status: 400 });
  }

  try {
    const result = await applyTriggerValueEdit(id, triggerId, value, {
      accountId,
      actorUserId: user.id,
    });
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
