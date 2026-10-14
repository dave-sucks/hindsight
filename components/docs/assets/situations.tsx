"use client";

import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { SituationsGrid } from "../framework/situations-grid";

/** The table's texts in the shape the situations picture takes, measured here in the browser. */
const GRID = (Object.keys(SITUATIONS) as SituationCode[]).map((code) => ({ code, name: SITUATIONS[code].name, chars: SITUATIONS[code].guidance.length, opening: "" }));

/** The sixteen texts, drawn at their sizes. */
export function SituationSizes() {
  return <SituationsGrid situations={GRID} />;
}
