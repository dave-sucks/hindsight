/**
 * A trigger run whose run ended failed (a doubled model that writes no note)
 * fails its function, so the failure handler can try the fire again. A replay
 * that reads the rows the run left takes that ending as the run's end.
 */
export function endedFailed(err: unknown): { failed: string } {
  if (err instanceof Error && err.name === "NonRetriableError") return { failed: err.message };
  throw err;
}
