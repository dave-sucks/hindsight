import Link from "next/link";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";

export function EnvironmentTabs({
  current,
  basePath,
  liveCount,
  paperCount,
}: {
  current: AlpacaEnvironment;
  basePath: string;
  liveCount: number;
  paperCount: number;
}) {
  // Hidden until the user actually has live data — a single-cohort
  // dashboard doesn't need a toggle. The settings page surfaces the
  // dual-key flow before any live position exists, so this is just
  // a "you have inventory in both buckets, pick one" affordance.
  if (liveCount === 0) return null;

  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5 text-xs">
      <Link
        href={`${basePath}?env=PAPER`}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${
          current === "PAPER" ? "bg-background shadow-sm" : "text-muted-foreground"
        }`}
      >
        Paper
        <span className="text-muted-foreground tabular-nums">{paperCount}</span>
      </Link>
      <Link
        href={`${basePath}?env=LIVE`}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${
          current === "LIVE" ? "bg-destructive/10 text-destructive shadow-sm" : "text-muted-foreground"
        }`}
      >
        Live
        <span className="tabular-nums">{liveCount}</span>
      </Link>
    </div>
  );
}

/** Parse environment from searchParams, defaulting to PAPER. */
export function parseEnvParam(env: string | string[] | undefined): AlpacaEnvironment {
  const raw = Array.isArray(env) ? env[0] : env;
  return raw === "LIVE" ? "LIVE" : "PAPER";
}
