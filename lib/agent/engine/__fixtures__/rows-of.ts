/** A built request's rows as the run's Context panel shows them, for the engine tests; null when its parts don't add up. */
import { byParts } from "@/lib/agent/run-requests";
import type { BuiltRequest } from "../types";

export function rowsOf(b: BuiltRequest) {
  const instructions = byParts(b.parts.filter((p) => p.where === "instructions"), b.instructions);
  const message = b.message ? byParts(b.parts.filter((p) => p.where === "message"), b.message) : { parts: [], after: "" };
  return instructions && message && !instructions.after && !message.after ? [...instructions.parts, ...message.parts] : null;
}
