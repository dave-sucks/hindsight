/**
 * runAccountCall's other paths (the digest's job test covers a call that
 * returns): a call that throws, a thread that can't be saved, and an account
 * with no owner.
 */
const runCreate = jest.fn(async () => ({ id: "run_account" }));
const runUpdate = jest.fn(async (_args: unknown) => ({}));
const owner = jest.fn(async (): Promise<string | null> => "user_owner");
jest.mock("@/lib/prisma", () => ({ prisma: { researchRun: { create: () => runCreate(), update: (a: unknown) => runUpdate(a) } } }));
jest.mock("@/lib/auth/account", () => ({ getOwnerUserId: () => owner() }));
jest.mock("@/lib/agent/run-requests", () => ({ saveRequestRecord: jest.fn() }));
const saveThread = jest.fn(async (..._args: unknown[]) => {});
jest.mock("@/lib/agent/run-thread", () => ({ saveRunThread: (...a: unknown[]) => saveThread(...a) }));

import { runAccountCall } from "./account-run";

const RUN = { accountId: "account_live", environment: "LIVE", mode: "PORTFOLIO_DIGEST" };

beforeEach(() => jest.clearAllMocks());

it("a call that throws closes its run FAILED and throws on", async () => {
  await expect(runAccountCall(RUN, async () => Promise.reject(new Error("timeout")))).rejects.toThrow("timeout");
  expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run_account" }, data: expect.objectContaining({ status: "FAILED" }) }));
});

it("with no owner on the account, the call is made with no run", async () => {
  owner.mockResolvedValueOnce(null);
  const call = jest.fn(async () => ({ request: { v: 1 as const, call: "Main", source: "test", model: "m", startedAt: "", endedAt: "", requests: [] }, thread: [] }));
  await runAccountCall(RUN, call);
  expect(call).toHaveBeenCalled();
  expect(runCreate).not.toHaveBeenCalled();
  expect(runUpdate).not.toHaveBeenCalled();
});

it("a thread that can't be saved is logged: the call's step finishes, so it is never retried into a second run", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  saveThread.mockRejectedValueOnce(new Error("connection reset"));
  const call = jest.fn(async () => ({ request: { v: 1 as const, call: "Main", source: "test", model: "m", startedAt: "", endedAt: "", requests: [] }, thread: [] }));
  // As Inngest runs a step: a throw is retried, the whole step again.
  const step = async <T,>(fn: () => Promise<T>): Promise<T> => fn().catch(() => fn());
  await expect(step(() => runAccountCall(RUN, call))).resolves.toBeDefined();
  expect(runCreate).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledTimes(1);
  expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETE" }) }));
});
