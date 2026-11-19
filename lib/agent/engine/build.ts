/**
 * The engine's request for a run: each fact its record lists, read by its
 * loader for the run's subject (lib/agent/context/), then put together
 * (./engine.ts).
 */
import { loadContext, type ContextRun } from "@/lib/agent/context";
import { composeAgentRequest, composeNewest } from "./engine";
import type { AgentInput, AgentRecord, BuiltNewest, BuiltRequest } from "./types";

/** Read the record's facts for the run, then build its request. */
export async function buildAgentRequest(record: AgentRecord, input: AgentInput, run: ContextRun): Promise<BuiltRequest> {
  return composeAgentRequest(record, input, await loadContext(record, run));
}

/** A conversation's instructions and what rides on its newest message, its facts read once. */
export async function buildConversation(record: AgentRecord, input: AgentInput, run: ContextRun): Promise<{ request: BuiltRequest; newest: BuiltNewest }> {
  const loaded = await loadContext(record, run);
  return { request: composeAgentRequest(record, input, loaded), newest: composeNewest(record, input, loaded) };
}
