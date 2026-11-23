/**
 * The Framework page's read section, built on the server from the one
 * builder (lib/agent/row-for-model.ts): which row keys each read sends and
 * each read as the model gets it (read-sample.ts). The page never hand-writes
 * any of it; when ROW_FIELDS changes, the page follows (lib/docs/read-cases.test.ts).
 */
import { ROW_FIELDS } from "@/lib/agent/row-for-model";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { LINE_KEYS, WRITER_KEYS, type FrameworkRead, type SituationOrigin } from "./framework-content";
import { buildReadSamples } from "./read-sample";

export const SITUATION_CODES = Object.keys(SITUATIONS) as SituationCode[];

/**
 * What usually puts a stock in each situation (situations.ts `fireCodes` and
 * `flagCodes`): a trigger firing, or a flag read off the stock's facts.
 */
export const SITUATION_ORIGIN: Record<SituationCode, SituationOrigin> = {
  PROMOTED_AWAITING: "flag",
  PROTECTIVE_SALE: "trigger",
  BUY_ARRIVES: "trigger",
  ADD_OR_WINNER: "trigger",
  REPORT: "trigger",
  FILING: "trigger",
  NEWS: "trigger",
  PROTECTION: "flag",
  REVIEW_DUE: "trigger",
  SOLD_ONE_REVIEW: "flag",
};

/** The keys each read sends: the line, the row, the row with everything a read can ask for, and the Writer's block. */
export function readKeys(): FrameworkRead["keys"] {
  return {
    line: [...LINE_KEYS],
    row: ROW_FIELDS.filter((f) => !f.ask).map((f) => f.key),
    full: ROW_FIELDS.map((f) => f.key),
    writer: [...WRITER_KEYS],
  };
}

export function buildFrameworkRead(): FrameworkRead {
  return { keys: readKeys(), samples: buildReadSamples() };
}
