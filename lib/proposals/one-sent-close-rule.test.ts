/**
 * one-sent-close-rule.test.ts — the database rule behind the position lock:
 * at most one full close SENT to Alpaca per position (SMMT 2026-09-15).
 *
 * The rule lives only in migration SQL — Prisma can't declare a partial
 * unique index without a preview feature — so `prisma migrate diff
 * --to-schema` proposes dropping it. This pins that the rule is created with
 * the right condition and that no later migration drops it.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS = path.join(__dirname, "../../prisma/migrations");
const RULE = "Order_one_sent_close_per_position";
const CREATED_IN = "20260917120000_order_one_sent_close_per_position";

const migrations = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const sql = (name: string) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");

describe("one sent full close per position — database rule", () => {
  it("is created as a unique index on positionId for PENDING full closes only", () => {
    const create = sql(CREATED_IN).replace(/--.*$/gm, "").replace(/\s+/g, " ");
    expect(create).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS "${RULE}" ON "Order" ("positionId")`);
    expect(create).toContain(`WHERE "intent" = 'CLOSE' AND "status" = 'PENDING';`);
  });

  it("is never dropped by a later migration", () => {
    const later = migrations.filter((name) => name > CREATED_IN);
    const dropping = later.filter((name) => new RegExp(`DROP\\s+INDEX[^;]*${RULE}`, "i").test(sql(name)));
    expect(dropping).toEqual([]);
  });
});
