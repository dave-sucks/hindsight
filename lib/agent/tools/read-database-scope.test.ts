/**
 * read-database-scope.test.ts — regression guard for account scoping.
 *
 * Two bugs this locks down:
 *
 *  1. `order` was listed in ACCOUNT_SCOPED, but the Order model has no
 *     `accountId` column (it carries userId + positionId). The tool injected
 *     `where.accountId` and Prisma threw "Unknown argument `accountId`" on
 *     EVERY order query — which is how the principal agent lost its only
 *     path to the approval queue. Order scopes through `position` instead.
 *
 *  2. Scope was applied by merging keys into the caller's where-clause and
 *     skipping any key the caller already used. A query that happened to
 *     filter on the scoping key (`accountId` directly, or a relation like
 *     `position`) silently dropped the account scope for the whole query.
 *     Scope is now AND-ed alongside the caller's filter, so it always
 *     survives.
 */

const mockFindMany = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findMany: mockFindMany },
    thesis: { findMany: mockFindMany },
    thesisUpdate: { findMany: mockFindMany },
  },
}));

import { readDatabase } from "./read-database";
import type { ToolContext } from "@/lib/agent/tool-context";

const ACCOUNT_ID = "acct_under_test";

const ctx = {
  runId: "run_test",
  userId: "user_test",
  accountId: ACCOUNT_ID,
  groupId: (g: string) => g,
} as unknown as ToolContext;

/** Invoke the tool and return the args handed to prisma.<model>.findMany. */
async function queryArgsFor(args: Record<string, unknown>) {
  mockFindMany.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = readDatabase(ctx) as any;
  const result = await t.execute(args, {});
  expect(result.ok).toBe(true);
  expect(mockFindMany).toHaveBeenCalledTimes(1);
  return mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
}

describe("read_database account scoping", () => {
  it("scopes `order` through the position relation, never a bare accountId", async () => {
    const { where } = await queryArgsFor({
      model: "order",
      where: { status: "AWAITING_APPROVAL" },
    });

    // The bug: an accountId key anywhere on the order where-clause is what
    // Prisma rejected.
    expect(where.accountId).toBeUndefined();
    expect(where).toEqual({
      AND: [
        { position: { accountId: ACCOUNT_ID } },
        { status: "AWAITING_APPROVAL" },
      ],
    });
  });

  it("keeps the position scope when the caller also filters on `position`", async () => {
    const { where } = await queryArgsFor({
      model: "order",
      where: { position: { symbol: "MU" } },
    });

    // Both must survive — the caller's filter narrows, it doesn't replace.
    expect(where).toEqual({
      AND: [
        { position: { accountId: ACCOUNT_ID } },
        { position: { symbol: "MU" } },
      ],
    });
  });

  it("keeps the account scope when the caller passes its own accountId", async () => {
    const { where } = await queryArgsFor({
      model: "thesis",
      where: { accountId: "some_other_account" },
    });

    // AND-ing a foreign accountId with ours yields zero rows — which is the
    // correct outcome. Merging would have handed over the other account's data.
    expect(where).toEqual({
      AND: [{ accountId: ACCOUNT_ID }, { accountId: "some_other_account" }],
    });
  });

  it("still scopes relation-only models like thesisUpdate", async () => {
    const { where } = await queryArgsFor({
      model: "thesisUpdate",
      where: { type: "PROPOSAL_REJECTED" },
    });

    expect(where).toEqual({
      AND: [{ thesis: { accountId: ACCOUNT_ID } }, { type: "PROPOSAL_REJECTED" }],
    });
  });

  it("rejects mutating-looking where keys before building the query", async () => {
    mockFindMany.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = readDatabase(ctx) as any;
    const result = await t.execute(
      { model: "order", where: { delete: { id: "x" } } },
      {},
    );
    expect(result.ok).toBe(false);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
