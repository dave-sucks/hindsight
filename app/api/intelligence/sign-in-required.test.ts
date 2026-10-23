/**
 * GET /api/intelligence/batches and /api/intelligence/routes answered anyone,
 * signed in or not, and /routes listed every account's analysts by name.
 * Both now check sign-in and an account like the other /api/intelligence
 * routes, and /routes lists only the caller's analysts.
 */

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const getAccountId = jest.fn();
jest.mock("@/lib/auth/account", () => ({
  getAccountId: (...a: unknown[]) => getAccountId(...a),
}));

const batchFindMany = jest.fn();
const analystFindMany = jest.fn();
const routeFindMany = jest.fn();
const routeCount = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    signalBatch: { findMany: (...a: unknown[]) => batchFindMany(...a) },
    agentConfig: { findMany: (...a: unknown[]) => analystFindMany(...a) },
    analystSignalRoute: { findMany: (...a: unknown[]) => routeFindMany(...a), count: (...a: unknown[]) => routeCount(...a) },
  },
}));

import { NextRequest } from "next/server";
import { GET as getBatches } from "./batches/route";
import { GET as getRoutes } from "./routes/route";

const batchesReq = () => new NextRequest("http://localhost/api/intelligence/batches?limit=1");
const routesReq = () => new NextRequest("http://localhost/api/intelligence/routes?all=1");

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  getAccountId.mockResolvedValue("acct-1");
  batchFindMany.mockResolvedValue([{ id: "b1", jobType: "MARKET_SWEEP", _count: { signals: 3 } }]);
  analystFindMany.mockResolvedValue([{ id: "a1", name: "Analyst One" }]);
  routeFindMany.mockResolvedValue([{ relevanceScore: 70, status: "READ" }]);
  routeCount.mockResolvedValue(1);
});

describe.each([
  ["batches", () => getBatches(batchesReq())],
  ["routes", () => getRoutes(routesReq())],
])("/api/intelligence/%s", (_name, call) => {
  it("refuses a signed-out request with 401 and reads nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
    expect(res.status).toBe(401);
    expect(batchFindMany).not.toHaveBeenCalled();
    expect(analystFindMany).not.toHaveBeenCalled();
  });

  it("refuses a user with no account with 403", async () => {
    getAccountId.mockResolvedValue(null);
    expect((await call()).status).toBe(403);
  });
});

it("batches: a signed-in user with an account gets the list", async () => {
  const res = await getBatches(batchesReq());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ id: "b1", jobType: "MARKET_SWEEP", _count: { signals: 3 } }]);
});

it("routes: lists only the caller's account's analysts", async () => {
  const res = await getRoutes(routesReq());
  expect(res.status).toBe(200);
  expect(analystFindMany).toHaveBeenCalledWith({ where: { enabled: true, accountId: "acct-1" }, select: { id: true, name: true } });
  expect((await res.json())[0]).toMatchObject({ analystId: "a1", analystName: "Analyst One", totalRoutes: 1, high: 1, read: 1 });
});
