/** Everything a morning run sends the model, its instructions then its first message, for the tests that read it. */
import { dailyRunRequest } from "@/lib/agent/system-prompt";

export function morningRunSent(...args: Parameters<typeof dailyRunRequest>): string {
  const r = dailyRunRequest(...args);
  return `${r.instructions}\n\n${r.message}`;
}
