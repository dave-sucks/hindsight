/**
 * The color of each part of a request to the model: the Framework page draws
 * its parts with these, and a run's Context panel colors what it sent the
 * same way. Solid parts ride on every request; outlined ones are added when
 * needed.
 */
import type { CSSProperties } from "react";

export type PartId = "job" | "house" | "analyst" | "tools" | "read" | "guidance" | "named";

export const SWATCH: Record<PartId, { className: string; style?: CSSProperties }> = {
  job: { className: "bg-foreground/70" },
  house: { className: "bg-sky-400" },
  analyst: { className: "bg-violet-400" },
  tools: { className: "bg-brand" },
  read: { className: "bg-blue-500" },
  guidance: { className: "border border-dashed border-muted-foreground bg-muted-foreground/35" },
  named: { className: "border border-dashed border-muted-foreground/50 bg-muted-foreground/10" },
};
