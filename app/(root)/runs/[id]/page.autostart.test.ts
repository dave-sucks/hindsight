/**
 * A live run's page starts the agent only when the page drives it. The 8 AM
 * cron runs its morning run on the server and saves no thread until it ends,
 * so its page used to send "Run" and start a second agent on the same run.
 */
let row: Record<string, unknown>;
jest.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) } }) }));
jest.mock("@/lib/prisma", () => ({ prisma: { researchRun: { findFirst: async () => row, updateMany: async () => ({ count: 1 }) } } }));
jest.mock("@/lib/agent/run-requests", () => ({ loadRunRequests: async () => [] }));
jest.mock("@/components/agent/AgentChat", () => ({ AgentChat: function AgentChat() { return null; } }));

import { isValidElement, type ReactElement } from "react";
import { AgentChat } from "@/components/agent/AgentChat";
import RunPage from "./page";

/** A morning run, RUNNING, a minute old, with no thread saved yet. */
const morningRun = (over: Record<string, unknown>) => ({
  id: "run_1",
  mode: "MORNING_PLAN",
  status: "RUNNING",
  startedAt: new Date(Date.now() - 60_000),
  podcastSegmentId: null,
  agentConfig: { id: "analyst_1", name: "PEAD Specialist" },
  segment: null,
  segmentTranscript: null,
  messages: [],
  ...over,
});

function chatProps(node: unknown): Record<string, unknown> | null {
  if (!isValidElement(node)) return Array.isArray(node) ? node.map(chatProps).find(Boolean) ?? null : null;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === AgentChat) return el.props;
  return chatProps(el.props.children);
}

async function autoStartOf(over: Record<string, unknown>): Promise<unknown> {
  row = morningRun(over);
  return chatProps(await RunPage({ params: Promise.resolve({ id: "run_1" }) }))?.autoStart;
}

describe("a live morning run's page", () => {
  it("doesn't start one the cron is running", async () => {
    expect(await autoStartOf({ source: "AGENT", parameters: { triggeredBy: "morning-cron", agentMode: true, analystName: "PEAD Specialist" } })).toBe(false);
  });

  it("starts the Run button's own run", async () => {
    expect(await autoStartOf({ source: "MANUAL", parameters: { agentMode: true, analystName: "PEAD Specialist" } })).toBe(true);
  });
});
