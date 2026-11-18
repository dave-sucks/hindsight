/** Everything a Writer agent sends the model, its instructions then its first message, for the tests that read it. */
import { writerRequest, type WriterResearchPromptOpts } from "@/lib/agent/run-thesis-writer";

export function writerSent(opts: WriterResearchPromptOpts, first?: { dataBlock: string; chatFound?: string | null }): string {
  const r = writerRequest(opts, first);
  return `${r.instructions}\n\n${r.message}`;
}
