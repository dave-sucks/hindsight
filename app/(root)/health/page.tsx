// Health — is Alpaca and the database telling the same story right now?
//
// Took over from the /intelligence Health tab when that page was deleted with
// the Signals machinery (2026-09-15). Everything else on that tab was signal
// and monitor telemetry for crons that no longer exist; the Alpaca↔DB drift
// view is the part that was still live, so it kept its screen and lost the
// rest. Fed by the hourly sync-heartbeat cron.

import { SyncHealthPanel } from "@/components/intelligence/sync-health-panel";

export default function HealthPage() {
  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Health</h1>
        <p className="text-sm text-muted-foreground">
          Alpaca against the database, per book. The hourly heartbeat writes
          the snapshot; anything out of line can be reconciled here.
        </p>
      </div>
      <SyncHealthPanel />
    </div>
  );
}
