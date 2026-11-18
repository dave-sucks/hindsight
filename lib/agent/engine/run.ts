/**
 * The agent runner (docs/plans/AGENT_ENGINE.md, pass 2): one way to run an
 * agent. It builds the request from the agent's record, gives the model the
 * record's tools, makes the call with the record's model, step limit and time
 * limit, and hands back what the run did. It never throws: a failed call comes
 * back with its error.
 *
 * Every call keeps its request on the run (lib/agent/model.ts). The same
 * refused call sent again gets one line asking the model not to, and a third
 * time ends the loop (lib/agent/repeat-refusal.ts). An OpenAI call asks for
 * strict tool schemas and, on a run, caches its prompt under the run's id.
 *
 * What the job does with the result (the thread, the token use, the run's
 * status) is still each job's own.
 */
import { generateText, stepCountIs, type ToolSet } from "ai";
import { modelFor } from "@/lib/agent/model";
import { repeatRefusalGuard } from "@/lib/agent/repeat-refusal";
import { addTokenUsage, emptyTokenUsage, type TokenUsage } from "@/lib/agent/token-usage";
import type { RunStep } from "@/lib/agent/run-thread";
import { buildAgentRequest, type Sources } from "./engine";
import type { AgentInput, BuiltRequest, RunnableRecord } from "./types";

export interface RunAgentArgs {
  input: AgentInput;
  /** Where the record's blocks read their data. */
  sources: Sources;
  /** The run that keeps the request; null keeps nothing (a dry run). */
  runId: string | null;
  /** Every tool, made for this run; the model is given the ones the record names. */
  toolset: ToolSet;
  /** Wraps the record's tools before the call: a run's limits, a dry run's stand-ins. */
  wrapTools?: (tools: ToolSet) => ToolSet;
  /** The code that runs the agent, kept with its request (the Context panel names the first message by it). */
  source: string;
}

export interface AgentRun {
  /** What was sent: the instructions, the first message and which part is which. */
  request: BuiltRequest;
  /** Its last reply, or null when it ended with none. */
  text: string | null;
  messages: unknown[];
  steps: RunStep[];
  toolCalls: Array<{ tool: string; input: unknown }>;
  usage: TokenUsage;
  /** Input tokens of each model request, in order. */
  requests: number[];
  error?: string;
}

export async function runAgent(record: RunnableRecord, args: RunAgentArgs): Promise<AgentRun> {
  const request = await buildAgentRequest(record, args.input, args.sources);
  const picked = Object.fromEntries(request.tools.map((name) => [name, args.toolset[name]])) as ToolSet;
  const tools = args.wrapTools ? args.wrapTools(picked) : picked;
  const usage = emptyTokenUsage();
  const requests: number[] = [];
  const done = (out: Partial<AgentRun>): AgentRun => ({ request, text: null, messages: [], steps: [], toolCalls: [], usage, requests, ...out });
  try {
    const { steps, response, text } = await generateText({
      model: modelFor(record.model, { runId: args.runId, call: "Main", source: args.source, parts: request.parts, agent: request.agent }),
      system: request.instructions,
      prompt: request.message,
      tools,
      providerOptions: { openai: { strictJsonSchema: true, ...(args.runId ? { promptCacheKey: args.runId } : {}) } },
      stopWhen: [stepCountIs(record.maxSteps), repeatRefusalGuard.stopWhen],
      prepareStep: repeatRefusalGuard.prepareStep,
      abortSignal: AbortSignal.timeout(record.timeoutMs),
      onStepFinish({ usage: u }) {
        addTokenUsage(usage, u);
        requests.push(u?.inputTokens ?? 0);
      },
    });
    return done({
      text: text?.trim() || null,
      messages: response.messages,
      steps: steps as unknown as RunStep[],
      toolCalls: steps.flatMap((s) => (s.toolCalls ?? []).map((c) => ({ tool: c.toolName, input: c.input }))),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[${args.source}] the run failed: ${error}`);
    return done({ error });
  }
}
