/** Everything a trigger fire sends the model, its instructions then its first message, for the tests that read it. */
import { triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";

export type TriggerRunArgs = Parameters<typeof triggerRunRequest>[0];

export function triggerRunSent(args: TriggerRunArgs, more?: string): string {
  const r = triggerRunRequest(args, more ? { more } : undefined);
  return `${r.instructions}\n\n${r.message}`;
}
