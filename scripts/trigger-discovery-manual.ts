/**
 * trigger-discovery-manual.ts
 *
 * Phase 2 E2E smoke test. Fires `app/discovery.run.manual` for ONE
 * analyst so we can verify the two-pass funnel before unpausing the
 * Sunday cron.
 *
 * Run with:
 *   npx tsx scripts/trigger-discovery-manual.ts <agentConfigId>
 *
 * Or with the default (Tech Momentum):
 *   npx tsx scripts/trigger-discovery-manual.ts
 *
 * After it returns, wait ~15-20 min and verify in /runs:
 *   - One parent run (mode=DISCOVERY) lands COMPLETE.
 *   - ≤5 child runs (mode=THESIS_WRITER) hang off the parent, each COMPLETE.
 *   - Each child produced a Thesis row (status=WATCHING) with the 9 flat
 *     section columns populated.
 *   - Direct PASS rows (direction='PASS', status='ARCHIVED') are also
 *     visible on the parent — these did NOT go through dispatch.
 *   - record_run_summary lists dispatched / passed / skipped buckets.
 *   - No errors in parent or child logs.
 *
 * Note: the discovery-run cron's event payload field is `agentConfigId`
 * (not `analystId`). The Inngest payload shape is:
 *   { name: "app/discovery.run.manual", data: { agentConfigId: "<id>" } }
 */

import { inngest } from "@/lib/inngest/client";

// Tech Momentum — has populated watchlist + clean Universe (per brief).
const DEFAULT_AGENT_CONFIG_ID = "cmmofy6t3000004l7858o1xma";

async function main() {
  const agentConfigId = process.argv[2] ?? DEFAULT_AGENT_CONFIG_ID;
  const t0 = Date.now();
  console.log(
    `[trigger-discovery-manual] sending app/discovery.run.manual for agentConfigId=${agentConfigId} …`,
  );

  const result = await inngest.send({
    name: "app/discovery.run.manual",
    data: { agentConfigId },
  });

  const elapsed = Date.now() - t0;
  console.log(
    `[trigger-discovery-manual] sent in ${elapsed}ms. Event IDs:`,
    result,
  );
  console.log(
    "\nNow wait ~15-20 min and check:\n" +
      "  - /runs — one parent DISCOVERY run lands COMPLETE\n" +
      "  - /runs/<parent-id> — ≤5 child THESIS_WRITER runs, each COMPLETE\n" +
      "  - Each child produced a Thesis (status=WATCHING, all 9 flat section columns populated)\n" +
      "  - PASS rows (direction='PASS', status='ARCHIVED') also visible on the parent run\n" +
      "  - Run summary lists dispatched / passed / skipped buckets",
  );
}

main().catch((err) => {
  console.error("[trigger-discovery-manual] failed:", err);
  process.exit(1);
});
