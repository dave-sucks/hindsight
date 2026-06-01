"use client";

/**
 * RunDiscoveryButton — entry-point button for the operator-driven
 * batched-discovery flow.
 *
 * Shipped 2026-05-31 as DISCOVERY_OVERHAUL SOON-2. Sibling to
 * RunResearchButton (which kicks off a MORNING_PLAN daily run).
 *
 * Unlike RunResearchButton, this does NOT POST to /api/research/agent-run
 * to create a fresh ResearchRun directly. It composes a kickoff message
 * and routes to /chat with the analyst pre-scoped and the kickoff queued
 * as the first message — the Principal Chat agent then runs the
 * batched-discovery flow per the prompt overlay in modes.ts. The first
 * POST from AgentChat creates the ResearchRun (mode=PRINCIPAL_CHAT) the
 * usual way; no separate "discovery chat" mode is needed.
 *
 * The kickoff message is intentionally generic. The agent has the
 * analyst's full scope block (universe, strategy, sizing, feeds,
 * holdDurations, signalTypes) injected into its system prompt by
 * buildPrincipalSystemPrompt, so it knows which discovery surfaces apply
 * (e.g., it'll only call get_market_movers if the analyst is subscribed
 * to a MARKET_MOVERS_* feed). The kickoff just names the goal; the
 * agent does the archetype-aware tool selection.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Compass, Loader2 } from "lucide-react";

const DISCOVERY_KICKOFF_MESSAGE = [
  "Run a batched discovery pass for this analyst.",
  "",
  "Start by reading my scope block above — universe, strategy, subscribed feeds — then pull the discovery surfaces that match my edge (some combination of get_market_movers scope:'universe', get_earnings_calendar scope:'universe', and read_signals — only call the ones my subscribed feeds cover).",
  "",
  "Triage what's interesting with 1-2 sentence reads per name. For survivors, run cheap research (get_theses cross-analyst overlap + get_stock_data) and score on the 4-dim composite. Dispatch up to 5 thesis-writers for composite-≥-4 survivors and PASS-record the researched-but-rejected names with reasoning. Skip-narrate (no thesis row) for obvious junk like ETFs or off-edge industries.",
  "",
  "Empty-handed is fine — if today's pool is thin, summarize what you saw and don't fabricate dispatches. End with record_run_summary + complete_run.",
].join("\n");

export function RunDiscoveryButton({
  analystId,
  size = "sm",
  variant = "outline",
}: {
  analystId: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost" | "secondary";
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = () => {
    setLoading(true);
    // URL-encode the kickoff so newlines + apostrophes survive the
    // round-trip. The chat page server-validates the analyst id against
    // the account before threading the params through.
    const url = `/chat?analyst=${encodeURIComponent(
      analystId,
    )}&kickoff=${encodeURIComponent(DISCOVERY_KICKOFF_MESSAGE)}`;
    router.push(url);
  };

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Compass className="h-3.5 w-3.5" />
      )}
      Run discovery
    </Button>
  );
}
