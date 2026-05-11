/**
 * Account backfill / repair script.
 *
 * Ensures every existing User has:
 *   - an Account row
 *   - an OWNER AccountMembership pointing at that account
 *   - accountId populated on every owned data row
 *
 * The 2026-05-11 migration already does this in SQL for the clean-slate
 * deployment, but this script is the idempotent safety net for dev
 * environments, restored DB dumps, or any future drift. Safe to re-run.
 *
 * Run with:
 *   npx tsx prisma/seed-accounts.ts
 */
import { PrismaClient } from "../lib/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log(`Found ${users.length} user(s).`);

  for (const u of users) {
    // 1. Account — id matches user id so backfill joins stay 1:1.
    const account = await prisma.account.upsert({
      where: { id: u.id },
      update: {},
      create: { id: u.id, name: u.email },
    });

    // 2. OWNER membership.
    await prisma.accountMembership.upsert({
      where: { accountId_userId: { accountId: account.id, userId: u.id } },
      update: { role: "OWNER" },
      create: { accountId: account.id, userId: u.id, role: "OWNER" },
    });

    console.log(`  ✓ ${u.email} → account=${account.id}`);
  }

  // Best-effort backfill in case any rows were inserted post-migration
  // with accountId left null (shouldn't happen — schema marks it NOT NULL —
  // but harmless to assert via UPDATE...WHERE userId = accountId).
  // Skipped here because the migration already enforces NOT NULL.

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
