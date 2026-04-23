/**
 * trigger-domain-monitor.ts
 *
 * Session 4 follow-up smoke test. Fires the `intelligence/domain-monitor`
 * Inngest event so the domain-monitor function runs on demand, then prints
 * the bookkeeping needed to confirm invocation.
 *
 * Run with:
 *   npx tsx scripts/trigger-domain-monitor.ts
 *
 * After it returns, check:
 *   1. Inngest dashboard → Functions → "Domain Monitors" → most recent run
 *      should show a `[domain-monitor] invoked at ...` log line.
 *   2. Postgres:
 *        SELECT id, status, "startedAt", "completedAt"
 *          FROM "SignalBatch"
 *         WHERE "jobType" = 'DOMAIN_MONITOR'
 *         ORDER BY "startedAt" DESC LIMIT 5;
 *      — a new row appearing proves the handler reached `createSignalBatch`
 *      (now hoisted out of step.run). No row = handler never started, which
 *      is an Inngest registration / event-delivery problem, not our code.
 */

import { inngest } from "@/lib/inngest/client";

async function main() {
  const t0 = Date.now();
  console.log("[trigger-domain-monitor] sending intelligence/domain-monitor …");

  const result = await inngest.send({
    name: "intelligence/domain-monitor",
    data: { source: "manual-smoke-test" },
  });

  const elapsed = Date.now() - t0;
  console.log(
    `[trigger-domain-monitor] sent in ${elapsed}ms. Event IDs:`,
    result,
  );
  console.log(
    "\nNow check:\n" +
      "  - Inngest dashboard for a fresh run of 'Domain Monitors'\n" +
      "  - SELECT * FROM \"SignalBatch\" WHERE \"jobType\" = 'DOMAIN_MONITOR' ORDER BY \"startedAt\" DESC LIMIT 1;\n" +
      "  - Server logs for `[domain-monitor] invoked at ...`",
  );
}

main().catch((err) => {
  console.error("[trigger-domain-monitor] failed:", err);
  process.exit(1);
});
