/**
 * An agent's context, read one way (docs/plans/AGENT_ENGINE.md): one loader
 * per fact, keyed to what the run is about (./bundles.ts). The engine calls
 * them (lib/agent/engine/build.ts); no agent's run code builds context. A
 * run hands over its subject, its tools and anything it has already read
 * for its own work; the record says which of the subject's facts it reads.
 */
import type { Loaded } from "@/lib/agent/engine/engine";
import { readsOf, type AgentRecord, type ContextId } from "@/lib/agent/engine/types";
import { BUNDLES, type SubjectKind } from "./bundles";
import type { ContextRun, Fact, Loader } from "./fact";
import { loadPieces } from "./market-and-portfolio";
import { earningsCalendarFact } from "./earnings-calendar";
import { earningsThisWeek } from "./earnings-this-week";
import { filingsThisWeek } from "./filings-this-week";
import { lastOutput } from "./last-output";
import { playbookRecord } from "./playbook-record";
import { holdingTriggers, playbooks, thePlaybook } from "./playbooks";
import { refusedCalls } from "./refused-calls";
import { situations } from "./situations";
import { stockData } from "./stock-data";
import { theAnalyst } from "./the-analyst";
import { theAnalysts } from "./the-analysts";
import { theBook } from "./the-book";
import { theCases } from "./the-cases";
import { theStock } from "./the-stock";

export type { ContextRun } from "./fact";
export type { Subject, SubjectKind } from "./bundles";

/** The four reads of one Market and portfolio read (./market-and-portfolio.ts). */
export const PIECES: readonly ContextId[] = ["market_numbers", "market_digest", "portfolio", "portfolio_digest"];

/** Every other fact's loader, for each subject whose bundle has it. */
export const FACTS: Record<Exclude<ContextId, "market_numbers" | "market_digest" | "portfolio" | "portfolio_digest">, Fact> = {
  the_analyst: theAnalyst,
  playbooks,
  the_playbook: thePlaybook,
  holding_triggers: holdingTriggers,
  situations,
  the_stock: theStock,
  stock_data: stockData,
  playbook_record: playbookRecord,
  the_book: theBook,
  the_cases: theCases,
  the_analysts: theAnalysts,
  earnings_this_week: earningsThisWeek,
  filings_this_week: filingsThisWeek,
  refused_calls: refusedCalls,
  earnings_calendar: earningsCalendarFact,
  last_output: lastOutput,
};

/** The facts a record reads that its subject's bundle doesn't have. */
export function outsideItsBundle(record: Pick<AgentRecord, "subject" | "instructions" | "context">): ContextId[] {
  return readsOf(record).filter((id) => !BUNDLES[record.subject].includes(id));
}

/** Read every fact the record lists, for its subject. */
export async function loadContext(record: AgentRecord, run: ContextRun): Promise<Loaded> {
  if (run.subject.kind !== record.subject) throw new Error(`${record.id} is about ${record.subject}, and its run is about ${run.subject.kind}`);
  const outside = outsideItsBundle(record);
  if (outside.length) throw new Error(`${record.id} reads ${outside.join(", ")}, outside ${record.subject}'s bundle`);
  const reads = readsOf(record);
  const loaded: Loaded = { context: {} };
  if (reads.some((id) => PIECES.includes(id))) loaded.pieces = await loadPieces(run, { portfolioDigest: reads.includes("portfolio_digest") });
  await Promise.all(
    reads
      .filter((id) => !PIECES.includes(id))
      .map(async (id) => {
        const load = (FACTS as Record<string, Fact>)[id][run.subject.kind as SubjectKind] as Loader | undefined;
        if (!load) throw new Error(`${id} has no loader for ${run.subject.kind}`);
        loaded.context![id] = await load(run as never);
      }),
  );
  return loaded;
}
