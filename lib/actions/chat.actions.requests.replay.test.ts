/**
 * A chat's Context, read by the session id a fresh chat sends.
 *
 * The agent route keeps what each message sent the model on the chat's run (lib/agent/model.ts), one record
 * per chat, the newest message's. A fresh chat never learns its run id: it sends a session id it made, and
 * the page's Context panel reads by that. Before this the page read once, at load, so a chat's Context came
 * only after it was reopened.
 */
import { prismaDouble, REPLAY_USER_ID, type PrismaDouble, type Row } from "@/lib/replay";

const run = (id: string, userId: string, session: string): Row => ({
  id, userId, accountId: "account_replay", mode: "PRINCIPAL_CHAT", source: "MANUAL", status: "COMPLETE",
  parameters: { chatSessionId: session }, startedAt: new Date("2026-11-15T15:00:00Z"),
});

/** What the route's model sends for one message: the instructions, then the conversation so far. */
const body = (...said: string[]) => ({
  model: "gpt-5.5",
  messages: [{ role: "system", content: "## Chat\nYou are the owner's co-pilot." }, ...said.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }))],
});

async function withChats<T>(fn: (m: { save: (runId: string, ...said: string[]) => Promise<void>; load: (which: { runId?: string; session?: string }, userId?: string) => Promise<Array<{ call: string; categories: Array<{ name: string; sections: Array<{ text: string }> }> }>>; db: PrismaDouble }) => Promise<T>): Promise<T> {
  const db = prismaDouble({ researchRun: [run("run_mine", REPLAY_USER_ID, "sess_mine"), run("run_theirs", "someone_else", "sess_theirs")], runMessage: [] });
  let out: T | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("server-only", () => ({}), { virtual: true });
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    const { saveRequestRecord } = await import("@/lib/agent/run-requests");
    const { loadChatRequests } = await import("@/lib/actions/chat.actions");
    const at = new Date().toISOString();
    out = await fn({
      // As the route keeps it: the first request of the message, replacing the chat's last.
      save: (runId, ...said) => saveRequestRecord(runId, { v: 1, call: "Message", source: "agent/principal", model: "gpt-5.5", startedAt: at, endedAt: at, requests: [body(...said)] }, { replace: true }),
      load: (which, userId = REPLAY_USER_ID) => loadChatRequests(which, userId),
      db,
    });
  });
  return out as T;
}

const newest = (calls: Array<{ categories: Array<{ name: string; sections: Array<{ text: string }> }> }>) =>
  calls[0].categories.find((c) => c.name === "Newest message")?.sections.map((s) => s.text).join("") ?? null;

describe("loadChatRequests", () => {
  it("finds a fresh chat's Context by its session id once its first message went out, and the newest message replaces it", async () => {
    await withChats(async ({ save, load }) => {
      expect(await load({ session: "sess_mine" })).toEqual([]);
      await save("run_mine", "How is CEG?");
      const first = await load({ session: "sess_mine" });
      expect(first).toHaveLength(1);
      expect(first[0].call).toBe("Message");
      await save("run_mine", "How is CEG?", "Fine.", "And GEV?");
      const second = await load({ session: "sess_mine" });
      expect(second).toHaveLength(1);
      expect(newest(second)).toBe("And GEV?");
    });
  });

  it("finds a resumed chat's by its run id", async () => {
    await withChats(async ({ save, load }) => {
      await save("run_mine", "How is CEG?");
      expect(await load({ runId: "run_mine" })).toHaveLength(1);
    });
  });

  it("reads only the signed-in user's own chat, by either key", async () => {
    await withChats(async ({ save, load }) => {
      await save("run_theirs", "Someone else's question");
      expect(await load({ session: "sess_theirs" })).toEqual([]);
      expect(await load({ runId: "run_theirs" })).toEqual([]);
      expect(await load({ session: "sess_theirs" }, "someone_else")).toHaveLength(1);
    });
  });

  it("reads nothing when it is given neither key", async () => {
    await withChats(async ({ save, load }) => {
      await save("run_mine", "How is CEG?");
      expect(await load({})).toEqual([]);
    });
  });
});
