/**
 * POST /api/theses/:id/triggers — add a new Price/Trailing trigger.
 *
 * Body: { action, predicate, fireMode?, rationale?, cooldownDays? }. The
 * trigger is validated by the same Zod schema the agent write-paths use
 * (invalid triggers are silently dropped at evaluation, so we reject them up
 * front), cooldown-defaulted, and — when it's the canonical stop/target —
 * mirrored onto Thesis + the open Position. A fired EXIT still flows through
 * the trigger pipeline + approval gate; this only persists the predicate.
 *
 * Reads moved out: the durable thesis dossier the sheet renders from is now
 * GET /api/theses/:id; the live price + resolved envelope is
 * GET /api/theses/:id/quote. This route is mutation-only. Individual trigger
 * edits/deletes live at /api/theses/:id/triggers/:triggerId (PATCH/DELETE).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  applyTriggerAdd,
  statusForEditError,
  ThesisEditError,
  type TriggerAddInput,
} from "@/lib/actions/thesis-edit";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: {
    action?: unknown;
    predicate?: unknown;
    fireMode?: unknown;
    rationale?: unknown;
    cooldownDays?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.action !== "string") {
    return NextResponse.json({ error: "Body must include an `action` string." }, { status: 400 });
  }
  if (body.predicate == null || typeof body.predicate !== "object") {
    return NextResponse.json({ error: "Body must include a `predicate` object." }, { status: 400 });
  }
  if (body.fireMode != null && body.fireMode !== "TACTICAL" && body.fireMode !== "DIRECT") {
    return NextResponse.json(
      { error: '`fireMode` must be "TACTICAL" or "DIRECT".' },
      { status: 400 },
    );
  }

  // Real validation (predicate kind, value ranges, 20-cap) happens inside
  // applyTriggerAdd via triggerSchema; bad shapes come back as INVALID.
  const input = {
    action: body.action,
    predicate: body.predicate,
    fireMode: body.fireMode,
    rationale: typeof body.rationale === "string" ? body.rationale : undefined,
    cooldownDays:
      typeof body.cooldownDays === "number" && Number.isFinite(body.cooldownDays)
        ? body.cooldownDays
        : undefined,
  } as unknown as TriggerAddInput;

  try {
    const result = await applyTriggerAdd(id, input, {
      accountId,
      actorUserId: user.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ThesisEditError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: statusForEditError(err.code) },
      );
    }
    console.error(`[trigger-add] unexpected error for ${id}:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
