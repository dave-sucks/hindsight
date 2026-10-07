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

const runInput = {
  analyst: { name: "Secular Compounder", mandate: null, voice: null, directionBias: "LONG_ONLY", holdDurations: ["SWING"], sectors: [], industries: [], themes: [], marketCapMin: null, marketCapMax: null, exclusionList: [], minConfidence: 70, minPositionSize: 3000, maxPositionSize: 10000, maxOpenPositions: 6 },
  portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [], activeTheses: [], performance: null, recentClosedTrades: [], priorityReviews: [],
  triggersFiredSinceLastRun: [], triggersMatchingNow: [], latestDigest: null,
  earnings: { reportingSoon: [], justReported: [] }, filings: { recent: [] }, intelligencePolicy: { maxSignalsPerRun: 0 }, openRefusals: [],
} as unknown as RunInput;

export const SAMPLE_PROMPTS: Record<PromptName, () => string> = {
  daily: () => buildDailyRunSystemPromptV2({ name: "Secular Compounder", minConfidence: 70, maxPositionSize: 10000, minPositionSize: 3000, maxOpenPositions: 6 }, runInput),
  // The job alone: the stock and the fire ride in the kickoff (tactical-kickoff.ts).
  tactical: () => buildTacticalSystemPrompt({ analyst: { name: "PEAD Specialist", mandate: null } }),
  discovery: () => buildDiscoverySystemPrompt({ config: { name: "PEAD Specialist", sectors: [], minConfidence: 70, maxPositionSize: 14000 }, analystId: "an", existingTickers: ["MU"] } as never),
  chat: () =>
    buildPrincipalSystemPrompt({
      scopedAnalyst: { id: "an", name: "Secular Compounder", analystPrompt: null, directionBias: "LONG_ONLY", holdDurations: ["SWING"], sectors: [], industries: [], themes: [], marketCapMin: null, marketCapMax: null, watchlist: [], exclusionList: [], minConfidence: 70, maxPositionSize: 10000, maxOpenPositions: 6 },
    }),
  writer: () =>
    buildWriterResearchPrompt({ analystPrompt: null, ticker: "TEST", mode: "mint", existingThesis: null, reason: "a screen", minConfidence: 70, runDate: "2026-09-25" } as never),
};
