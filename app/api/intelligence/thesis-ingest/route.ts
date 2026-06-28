// ── External Thesis Ingest (HTTP) ────────────────────────────────────────────
// Secret-protected entry point for Postman / curl / a future MCP server. The
// browser paste UI uses the app-authed server action instead — both share
// lib/intelligence/ingest-thesis.ts. Zero LLM cost.
// See docs/plans/EXTERNAL_THESIS_INGEST.md.

import { NextResponse } from "next/server";
import { ingestThesis } from "@/lib/intelligence/ingest-thesis";

export async function POST(req: Request) {
  const secret = process.env.THESIS_INGEST_SECRET;
  const provided =
    req.headers.get("x-ingest-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = await ingestThesis(body);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, runId: result.runId },
      { status: result.status },
    );
  }
  return NextResponse.json({
    success: true,
    runId: result.runId,
    summary: result.summary,
    thesis: result.thesis,
  });
}
