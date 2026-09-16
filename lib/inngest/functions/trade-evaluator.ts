import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  getThesisBullCaseBullets,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(from: string | Date, to: string | Date | null): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const evaluateTrade = inngest.createFunction(
  {
    id: "evaluate-trade",
    name: "Post-Trade Agent Evaluation",
    // Don't retry — evaluation is best-effort and trade is already closed
    retries: 1,
  },
  { event: "trade/closed" },
  async ({ event, step }) => {
    const { positionId } = event.data as { positionId: string };

    // Step 1: Fetch position + thesis from DB. Selects the structured
    // belief fields (coreBelief / keyAssumptions / invalidationConds) so
    // the GPT-4o post-mortem can grade against the falsifiable claim,
    // not just the trade rationale. Pre-this-PR the eval saw only the
    // narrative — couldn't tell when an assumption flipped under it.
    const position = await step.run("fetch-position", async () => {
      return prisma.position.findUnique({
        where: { id: positionId },
        include: {
          decisions: {
            take: 1,
            include: {
              thesis: {
                select: {
                  // PR-9 flat schema: reasoningSummary → snapshot,
                  // thesisBullets → bullCase, signalTypes dropped.
                  snapshot: true,
                  bullCase: true,
                  coreBelief: true,
                  keyAssumptions: true,
                  invalidationConds: true,
                  horizon: true,
                  direction: true,
                },
              },
            },
          },
        },
      });
    });

    if (!position) {
      return { skipped: true, reason: "position-not-found" };
    }

    if (!position.closePrice || !position.outcome) {
      return { skipped: true, reason: "position-not-closed" };
    }

    const thesis = position.decisions[0]?.thesis;

    // Step 2: GPT-4o evaluation (direct call, no Railway dependency)
    const evaluation = await step.run("run-evaluation", async () => {
      const holdDays = daysBetween(position.openedAt as unknown as string, position.closedAt as unknown as string | null);
      const pnlPct = ((Number(position.closePrice) - Number(position.avgCost)) / Number(position.avgCost) * 100).toFixed(2);

      // Belief block — the structured claim the agent committed to at
      // mint time. Lets the evaluator distinguish "thesis correct, exit
      // timing was off" from "thesis broken, lucky we got out." Falls
      // through gracefully on legacy theses with empty fields.
      const beliefBlock = (() => {
        if (!thesis) return "";
        const lines: string[] = [];
        if (thesis.horizon) lines.push(`Horizon: ${thesis.horizon}`);
        if (thesis.coreBelief) lines.push(`\nCore belief: ${thesis.coreBelief}`);
        if (thesis.keyAssumptions?.length) {
          lines.push(`\nKey assumptions (must remain true for the belief to hold):`);
          for (const a of thesis.keyAssumptions) lines.push(`- ${a}`);
        }
        if (thesis.invalidationConds?.length) {
          lines.push(`\nInvalidation conditions (would prove the belief wrong):`);
          for (const i of thesis.invalidationConds) lines.push(`- ${i}`);
        }
        return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
      })();

      const { text } = await generateText({
        // 2026-06-15 — gpt-4o → gpt-4o-mini cost swap. Post-trade post-mortem
        // is a summary, not a decision. docs/plans/OPENAI_COST_REDUCTION.md #3.
        model: openai("gpt-4o-mini"),
        system:
          "You are a trading coach evaluating closed paper trades. Be honest and constructive. Focus on what the analyst got right, what they missed, and what they should learn. " +
          "When the thesis included a structured belief (core_belief + key_assumptions + invalidation_conditions), grade against the BELIEF, not just the trade rationale: did each key_assumption actually hold through the hold period? Did any invalidation_condition come true? If the trade closed at a profit but the belief was already broken, name that — \"right outcome, wrong reasons\" is still a learning. " +
          "Keep it to 3-4 paragraphs.",
        prompt: `Evaluate this closed paper trade:

Ticker: ${position.symbol}
Direction: ${position.direction}
Entry: $${position.avgCost}
Exit: $${position.closePrice}
P&L: ${pnlPct}%
Outcome: ${position.outcome}
Close reason: ${position.closeReason ?? "MANUAL"}
Hold duration: ${holdDays} days
${thesis ? (() => {
  // PR-9: extract narrative from the new flat columns for the evaluator
  // prompt. signalTypes was dropped; omitted from the prompt entirely.
  const reasoning = getThesisSnapshotText(thesis);
  const bullets = getThesisBullCaseBullets(thesis);
  const parts: string[] = [];
  if (reasoning) parts.push(`\nOriginal thesis (rationale): ${reasoning}`);
  if (bullets.length) parts.push(`\nThesis bullets:\n${bullets.map((b) => `- ${b}`).join("\n")}`);
  return parts.join("");
})() : ""}${beliefBlock}

Write an honest post-trade evaluation. Was the BELIEF correct (each assumption, each invalidation condition)? Was sizing appropriate? What should the analyst learn from this trade?`,
        maxOutputTokens: 500,
      });

      return text;
    });

    // Step 3: Store evaluation + write EVALUATED PositionEvent
    await step.run("store-evaluation", async () => {
      await prisma.position.update({
        where: { id: positionId },
        data: { agentEvaluation: evaluation },
      });

      await prisma.positionEvent.create({
        data: {
          positionId,
          eventType: "EVALUATED",
          description: evaluation,
          priceAt: null,
          pnlAt: null,
        },
      });
    });

    // Step 4 used to walk Thesis → Signal → Monitor and credit each monitor
    // that sourced the trade with a win or a loss. Deleted 2026-09-15 with
    // the rest of the Signals machinery: nothing routes a signal any more,
    // so no thesis written since carries a sourceSignalId to walk, and the
    // ROI counters it maintained were only ever read by a monitors page
    // that is also gone.

    return { positionId, evaluated: true };
  }
);
