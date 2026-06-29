"use server";

// ── Thesis-ingest server action (paste UI) ───────────────────────────────────
// App-authenticated entry point for the /intelligence/ingest page. No secret in
// the browser — the operator is already signed in. Shares the same core as the
// HTTP endpoint. See docs/plans/EXTERNAL_THESIS_INGEST.md.

import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ingestThesis } from "@/lib/intelligence/ingest-thesis";

export type IngestActionResult =
  | { ok: true; summary: string; runId: string }
  | { ok: false; error: string };

export async function ingestThesisAction(
  analystId: string,
  jsonText: string,
): Promise<IngestActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(jsonText) as Record<string, unknown>;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { ok: false, error: "JSON must be a single object." };
    }
  } catch (e) {
    return {
      ok: false,
      error: `Invalid JSON: ${e instanceof Error ? e.message : "parse error"}`,
    };
  }

  // Verify the chosen analyst belongs to the signed-in user, then force it
  // (ignore any `analyst` field the chat may have included in the JSON).
  const config = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId: user.id },
    select: { id: true },
  });
  if (!config) return { ok: false, error: "Analyst not found for your account." };

  delete payload.analyst;
  payload.analyst_id = analystId;

  const result = await ingestThesis(payload);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, summary: result.summary, runId: result.runId };
}
