/**
 * The shape of a fact's loader (./index.ts lists them): for each subject
 * whose bundle has the fact (./bundles.ts), how its text is read for a run.
 */
import type { ToolSet } from "ai";
import type { AgentId } from "@/lib/agent/engine/types";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import type { Subject, SubjectKind, SubjectOf } from "./bundles";

/** A run, as its context is read for it. */
export interface ContextRun<S extends Subject = Subject> {
  subject: S;
  now: Date;
  /** The agent: what it wrote on its last run is its own (last_output). */
  agent: AgentId;
  /** The run's tools: a fact that is a tool's read (the stock's row, the analyst's book, the earnings calendar) is read through them, as the run would read it. */
  toolset?: ToolSet;
  /**
   * What the run has already read for its own work, so it isn't read twice:
   * the stock's data the Writer pulled before its call (its save checks
   * against the same pull), the snapshot the 8 PM digest is written on (the
   * job saves it with the digest).
   */
  given?: { stockData?: string | null; snapshot?: PortfolioSnapshot };
}

export type Loader<K extends SubjectKind = SubjectKind> = (run: ContextRun<SubjectOf<K>>) => Promise<string | null>;

/** A fact: its loader for each subject whose bundle has it. */
export type Fact = { [K in SubjectKind]?: Loader<K> };

const memo = new WeakMap<ContextRun, Map<string, Promise<unknown>>>();

/** One read per run: two facts from the same read (the stock's row and its situations) read it once. */
export function once<T>(run: ContextRun, key: string, read: () => Promise<T>): Promise<T> {
  let reads = memo.get(run);
  if (!reads) memo.set(run, (reads = new Map()));
  if (!reads.has(key)) reads.set(key, read());
  return reads.get(key) as Promise<T>;
}
