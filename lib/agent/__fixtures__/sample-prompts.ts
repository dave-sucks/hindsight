/**
 * sample-prompts.ts — the five agent prompts, built from one fixed sample
 * input. Shared by the field-contract test (is each rule stated?) and the
 * prompt-size test (did a prompt get longer?).
 */
import { buildPrincipalSystemPrompt } from "@/lib/agent/modes";
import { buildDailyRunSystemPromptV2 } from "@/lib/agent/system-prompt";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { buildDiscoverySystemPrompt } from "@/lib/agent/system-prompts/discovery";
import { buildWriterResearchPrompt } from "@/lib/agent/run-thesis-writer";
import type { RunInput } from "@/lib/agent/run-input";
import type { PromptName } from "@/lib/agent/tools/field-contract";
import { guidanceFor } from "@/lib/agent/situations";
import { rowForModel } from "@/lib/agent/row-for-model";
import { sentenceOf } from "@/lib/agent/triggers/condition";

const runInput = {
  portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [], activeTheses: [], performance: null, recentClosedTrades: [], priorityReviews: [],
  triggersFiredSinceLastRun: [], triggersMatchingNow: [],
  earnings: { reportingSoon: [], justReported: [] }, filings: { recent: [] }, intelligencePolicy: { maxSignalsPerRun: 0 }, openRefusals: [],
} as unknown as RunInput;

const trailTrigger = { id: "trig_trail", predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, action: "EXIT", rationale: "Protect the gain." };

export const SAMPLE_PROMPTS: Record<PromptName, () => string> = {
  daily: () => buildDailyRunSystemPromptV2({ name: "Secular Compounder", minConfidence: 70, maxPositionSize: 10000, minPositionSize: 3000, maxOpenPositions: 6 }, runInput),
  tactical: () =>
    buildTacticalSystemPrompt({
      analyst: { name: "PEAD Specialist", analystPrompt: null },
      // The same stock as before step 10, as the trigger run reads it: get_theses's short row with the setup's lines.
      stock: {
        ticker: "HPE",
        direction: "LONG",
        row: rowForModel(
          { id: "thesis_1", ticker: "HPE", status: "HOLDING", direction: "LONG", horizon: "TARGET", coreBelief: "Belief.", keyAssumptions: ["a"], invalidationConds: ["b"], entryPrice: 53, targetPrice: 70, stopLoss: 50, position: { quantity: 60, avgCost: 53.1, peakPrice: 62.7 }, triggers: [{ id: trailTrigger.id, says: sentenceOf(trailTrigger), rationale: trailTrigger.rationale }], situations: ["PROTECTIVE_SALE"] },
          { named: true, size: "short", setupLines: true },
        ),
      },
      trigger: trailTrigger, position: { peakPrice: 62.7 }, latestDigest: null,
      // A trail sale on a holding: the one situation it puts the stock in.
      situations: { codes: ["PROTECTIVE_SALE"], guidance: guidanceFor(["PROTECTIVE_SALE"]) },
    } as never),
  discovery: () => buildDiscoverySystemPrompt({ config: { name: "PEAD Specialist", sectors: [], minConfidence: 70, maxPositionSize: 14000 }, analystId: "an", existingTickers: ["MU"] } as never),
  chat: () =>
    buildPrincipalSystemPrompt({
      scopedAnalyst: { id: "an", name: "Secular Compounder", analystPrompt: null, directionBias: "LONG_ONLY", holdDurations: ["SWING"], sectors: [], industries: [], themes: [], marketCapMin: null, marketCapMax: null, watchlist: [], exclusionList: [], minConfidence: 70, maxPositionSize: 10000, maxOpenPositions: 6 },
    }),
  writer: () =>
    buildWriterResearchPrompt({ analyst: { analystPrompt: null, minConfidence: 70 }, ticker: "TEST", mode: "mint", existingThesis: null, reason: "a screen", runDate: "2026-09-25" } as never),
};
