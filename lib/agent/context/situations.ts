/**
 * situations: the situations the stock is in and what each asks (its skill,
 * lib/agent/situation-skills.ts), from the same read as its row. They end the
 * instructions of the agent that answers them.
 */
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import type { Fact } from "./fact";
import { readStock } from "./the-stock";

/** The stock's situations under their heading, in rank order. Null when it is in none a run answers. */
export function situationsText(ticker: string, s: { codes: SituationCode[]; guidance: Partial<Record<SituationCode, string>> } | null | undefined): string | null {
  const guidance = Object.entries(s?.guidance ?? {}) as Array<[SituationCode, string]>;
  return guidance.length
    ? `## Its situations\nThe situations $${ticker} is in (${(s?.codes ?? []).join(", ")}), and what each asks:\n\n` +
      guidance.map(([code, text]) => `${code} — ${SITUATIONS[code].name}\n${text}`).join("\n\n")
    : null;
}

export const situations: Fact = {
  thesis: async (run) => situationsText(run.subject.ticker, (await readStock(run))?.situations),
};
