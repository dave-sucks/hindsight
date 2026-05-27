/**
 * Regression guard for GAPS P1-4. `Thesis.promotedAt` must be declared
 * `@db.Timestamptz(6)`. Stored as bare `timestamp without time zone`, the
 * `@prisma/adapter-pg` write path AM/PM-flips JS `Date` writes (3 production
 * rows on 2026-05-26 stored exactly 12h ahead of intent before the fix).
 *
 * The audit-row peer `ThesisUpdate.timestamp` uses Postgres `now()` via the
 * column default and isn't affected by the adapter bug, so it stays bare for
 * now; if someone migrates it to take a JS Date later this test should grow
 * to cover it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(__dirname, "schema.prisma"), "utf8");

describe("Prisma schema — datetime column types", () => {
  it("Thesis.promotedAt is declared @db.Timestamptz(6)", () => {
    // Match the field declaration line, ignoring nullability and surrounding
    // whitespace. The annotation must be on the same line.
    const match = schema.match(/^\s*promotedAt\s+DateTime\?\s+(.+)$/m);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/@db\.Timestamptz\(6\)/);
  });
});
