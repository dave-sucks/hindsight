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
 * strict tool schemas and, on a run, caches its prompt under the run's id;
 * an Anthropic call marks its instructions and its last tool for the cache.
 * A call ends at its step limit, its time limit, or once its save goes
 * through (the record's `endsWith`); one cut short hands back what it did.
 * How the model is called sits beside the model on the record: the API, the
 * reply's budget, the provider's own tools (its web search) and the reply's
 * JSON schema when the reply is data.
 *
 * `runAgentAsRun` runs an agent as a saved run: it opens the run, runs the
 * agent, and keeps the run's books (its thread, its token use, its notes on
 * its proposals and its status), the same way for every agent.
 */
import { generateText, jsonSchema, NoObjectGeneratedError, Output, stepCountIs, type ToolSet } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { prisma } from "@/lib/prisma";
import { modelFor } from "@/lib/agent/model";
import { cachedSystem, cachedTools } from "@/lib/agent/prompt-cache";
import { repeatRefusalGuard } from "@/lib/agent/repeat-refusal";
import { addTokenUsage, emptyTokenUsage, recordTokenUsage, type TokenUsage } from "@/lib/agent/token-usage";
import { saveRunThread, type RunStep } from "@/lib/agent/run-thread";
import { putNotesOnRunProposals } from "@/lib/proposals/auto-writeup";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { openingOf } from "./engine";
import { buildAgentRequest } from "./build";
import type { ContextRun, Subject } from "@/lib/agent/context";
import type { AgentInput, BuiltRequest, ProviderToolId, RunnableRecord } from "./types";

type Provider = "anthropic" | "openai";
const providerOf = (model: string): Provider => (model.startsWith("claude") ? "anthropic" : "openai");

/** The provider's own tools a record can name, made for the record's provider. */
const PROVIDER_TOOLS: Record<ProviderToolId, (provider: Provider, record: RunnableRecord) => unknown> = {
  web_search: (provider, record) =>
    provider === "anthropic" ? anthropic.tools.webSearch_20250305(record.searchesPerCall ? { maxUses: record.searchesPerCall } : {}) : openai.tools.webSearch({}),
};

/** A step as the runner reads it. */
interface StepLike {
  text?: string;
  toolCalls?: ReadonlyArray<{ toolName: string; input: unknown }>;
  toolResults?: ReadonlyArray<{ toolName: string; output?: unknown }>;
}

/** A save went through: our tools say `ok`, the Writer's save says `accepted`. */
const wentThrough = (output: unknown) => {
  const o = output as { ok?: unknown; accepted?: unknown } | null | undefined;
  return o?.ok === true || o?.accepted === true;
};

export interface RunAgentArgs {
  input: AgentInput;
  /** What the run is about: its context is read for it (lib/agent/context/). */
  subject: Subject;
  /** What the run has already read for its own work, handed over so it isn't read twice. */
  given?: ContextRun["given"];
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
  /** Each step's text, in order: everything it wrote, not only its last reply. */
  texts: string[];
  /** A reply that is data (the record's `reply`), parsed. */
  output?: unknown;
  /** Why the model stopped ("stop", "length", "tool-calls"…). */
  finishReason?: string;
  error?: string;
}

export async function runAgent(record: RunnableRecord, args: RunAgentArgs): Promise<AgentRun> {
  const request = await buildAgentRequest(record, args.input, { subject: args.subject, now: args.input.now, agent: record.id, toolset: args.toolset, given: args.given });
  const picked = Object.fromEntries(request.tools.map((name) => [name, args.toolset[name]])) as ToolSet;
  const provider = providerOf(record.model);
  const provided = Object.fromEntries((record.providerTools ?? []).map((id) => [id, PROVIDER_TOOLS[id](provider, record)]));
  // The provider's tools first: on Anthropic the cache mark goes on the last tool.
  const tools = cachedTools(provider, { ...provided, ...(args.wrapTools ? args.wrapTools(picked) : picked) }) as ToolSet;
  const reply = record.reply ? Output.object({ schema: jsonSchema(record.reply.schema(args.input)), name: record.reply.name }) : undefined;
  const usage = emptyTokenUsage();
  const requests: number[] = [];
  // What the call has done so far, kept step by step so a call cut short still hands it back.
  let soFar: { messages: unknown[]; steps: StepLike[] } = { messages: [], steps: [] };
  const fromSteps = (steps: StepLike[]) => ({
    steps: steps as unknown as RunStep[],
    toolCalls: steps.flatMap((s) => (s.toolCalls ?? []).map((c) => ({ tool: c.toolName, input: c.input }))),
    texts: steps.flatMap((s) => (s.text?.trim() ? [s.text] : [])),
  });
  const done = (out: Partial<AgentRun>): AgentRun => ({ request, text: null, messages: [], steps: [], toolCalls: [], texts: [], usage, requests, ...out });
  const saved = ({ steps }: { steps: ReadonlyArray<StepLike> }) =>
    Boolean(record.endsWith && steps.at(-1)?.toolResults?.some((r) => r.toolName === record.endsWith && wentThrough(r.output)));
  try {
    const result = await generateText({
      model: modelFor(record.model, { runId: args.runId, call: "Main", source: args.source, parts: request.parts, agent: request.agent, api: record.api }),
      system: cachedSystem(provider, request.instructions),
      prompt: request.message,
      tools,
      ...(reply ? { output: reply } : {}),
      ...(record.maxOutputTokens ? { maxOutputTokens: record.maxOutputTokens } : {}),
      providerOptions: { openai: { strictJsonSchema: true, ...(args.runId ? { promptCacheKey: args.runId } : {}) } },
      stopWhen: [stepCountIs(record.maxSteps), repeatRefusalGuard.stopWhen, saved],
      prepareStep: repeatRefusalGuard.prepareStep,
      abortSignal: AbortSignal.timeout(record.timeoutMs),
      onStepFinish(step) {
        addTokenUsage(usage, step.usage);
        requests.push(step.usage?.inputTokens ?? 0);
        // A step's messages are the whole call's so far: replace, never append.
        soFar = { messages: step.response?.messages ?? soFar.messages, steps: [...soFar.steps, step as unknown as StepLike] };
      },
    });
    const { steps, response, text, finishReason } = result;
    const ran = { text: text?.trim() || null, messages: response.messages, ...fromSteps(steps as unknown as StepLike[]), finishReason };
    if (record.maxOutputTokens && finishReason === "length") return done({ ...ran, error: "The reply was cut off at its limit." });
    return done(reply ? { ...ran, output: result.output } : ran);
  } catch (err) {
    // A reply that is data and doesn't parse: the SDK throws it from the call.
    const error = NoObjectGeneratedError.isInstance(err)
      ? err.finishReason === "length"
        ? "The reply was cut off at its limit."
        : "The reply wasn't the shape asked for."
      : err instanceof Error
        ? err.message
        : String(err);
    console.warn(`[${args.source}] the run failed: ${error}`);
    return done({ error, messages: soFar.messages, ...fromSteps(soFar.steps) });
  }
}

/** Why a run failed, kept in its parameters, where its page shows it. Logged, never thrown. */
async function keepError(runId: string, error: string): Promise<void> {
  try {
    const row = await prisma.researchRun.findUnique({ where: { id: runId }, select: { parameters: true } });
    const parameters = row?.parameters && typeof row.parameters === "object" ? (row.parameters as Record<string, unknown>) : {};
    await prisma.researchRun.update({ where: { id: runId }, data: { parameters: { ...parameters, error } as object } });
  } catch (err) {
    console.warn(`[runner] run ${runId}'s error couldn't be kept:`, err instanceof Error ? err.message : err);
  }
}

/** Who a saved run is for: an account's book, and the analyst when it works for one. */
export interface RunFor {
  userId: string;
  accountId: string;
  environment: "PAPER" | "LIVE";
  /** The analyst it works for; none for an agent of the whole book. */
  analystId?: string | null;
}

/** An agent as the runner runs it on its own: its record, its run's mode, what its run is given, and its own save. */
export interface AgentToRun {
  record: RunnableRecord;
  /** The run's mode (ResearchRun.mode). */
  mode: string;
  /** Its context reads and its tools, made for one run. */
  args: (target: RunFor, runId: string) => Omit<RunAgentArgs, "runId"> | Promise<Omit<RunAgentArgs, "runId">>;
  /** What it keeps of its own once the run is done (the Portfolio Manager's write-up). A reason back means its reply couldn't be used: the run fails with it. */
  keep?: (runId: string, done: AgentRun, target: RunFor) => Promise<string | void>;
  /** How its reply reads on the run page, when the reply is data: the thread's messages after its opening. */
  thread?: (done: AgentRun) => unknown[];
}

export interface SavedRun extends AgentRun {
  runId: string;
  status: "COMPLETE" | "FAILED";
}

/**
 * Run an agent as a saved run. It opens the run (RUNNING, with the record's
 * model and the day in New York), runs the agent with the args its own code
 * makes for that run (its context and its tools) and the message whoever
 * started it wrote (the schedule's kickoff), and keeps the run's books:
 * the thread the run page shows (its opening, then the model's messages), the
 * token use, its note on a stock as that stock's proposal's reason (as on
 * every run), then what the agent keeps of its own. Last, the status:
 * FAILED when the call failed or ended without its last reply, else
 * COMPLETE, set only while the run is still RUNNING; a FAILED run keeps why
 * in its parameters. Never throws once the run is open.
 */
export async function runAgentAsRun(agent: AgentToRun, target: RunFor, message?: string | null): Promise<SavedRun> {
  const { record } = agent;
  const started = new Date();
  const { id: runId } = await prisma.researchRun.create({
    data: {
      userId: target.userId,
      accountId: target.accountId,
      ...(target.analystId ? { agentConfigId: target.analystId } : {}),
      source: "AGENT",
      status: "RUNNING",
      mode: agent.mode,
      environment: target.environment,
      parameters: { date: etDateOf(started), model: record.model },
    },
    select: { id: true },
  });
  let done: AgentRun;
  let source: string = record.id;
  try {
    const args = await agent.args(target, runId);
    source = args.source;
    // The run's task, as whoever started it wrote it (the schedule's kickoff).
    done = await runAgent(record, { ...args, ...(message ? { input: { ...args.input, message } } : {}), runId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[${source}] run ${runId} couldn't start: ${error}`);
    done = { request: { agent: record.id, instructions: "", message: "", parts: [], tools: [] }, text: null, messages: [], steps: [], toolCalls: [], texts: [], usage: emptyTokenUsage(), requests: [], error };
  }
  // The opening is what a person reads in the first message; a first message that is all context has none.
  const said = openingOf(done.request);
  const opening = said ? [{ role: "user", content: [{ type: "text", text: said }] }] : [];
  await saveRunThread(runId, agent.thread ? { opening, messages: agent.thread(done), steps: [] } : { opening, messages: done.messages, steps: done.steps }, source);
  await recordTokenUsage(runId, done.usage, record.model);
  await putNotesOnRunProposals({ runId, analystId: target.analystId ?? null, since: started }).catch((err) =>
    console.error(`[${source}] could not put the notes on run ${runId}'s proposals:`, err instanceof Error ? err.message : err),
  );
  const unusable = agent.keep
    ? await agent.keep(runId, done, target).catch((err) => void console.error(`[${source}] run ${runId}'s own save failed:`, err instanceof Error ? err.message : err))
    : undefined;
  if (unusable && !done.error) done = { ...done, error: unusable };
  const status = done.error || !done.text ? "FAILED" : "COMPLETE";
  await prisma.researchRun
    .updateMany({ where: { id: runId, status: "RUNNING" }, data: { status, completedAt: new Date() } })
    .catch((err) => console.warn(`[${source}] run ${runId} couldn't be marked done:`, err instanceof Error ? err.message : err));
  if (status === "FAILED") await keepError(runId, done.error ?? "The run ended without its last reply.");
  return { ...done, runId, status };
}
