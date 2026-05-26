/**
 * Run mode catalog — shared between the /runs filter bar (client) and the
 * /runs page server component (for searchParam validation). Lives outside
 * the "use client" file so the server can iterate it at module load.
 */

export const RUNS_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "MORNING_PLAN", label: "Morning" },
  { value: "INTRADAY_TACTICAL", label: "Tactical" },
  { value: "DISCOVERY", label: "Discovery" },
  { value: "THESIS_WRITER", label: "Thesis Research" },
];
