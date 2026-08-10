/**
 * deploy-migrate.mjs — run `prisma migrate deploy` as the FIRST step of the
 * Vercel production build.
 *
 * Why this exists
 * ---------------
 * The build script used to be `prisma generate && next build`. Nothing ever
 * ran `prisma migrate deploy`, so a merged migration never reached the
 * database — every schema change had to be applied by hand, and forgetting
 * meant the new code shipped against a database missing its columns. Prisma
 * then throws on every query touching them, and the whole site returns
 * "Application error: a server-side exception has occurred".
 *
 * That is not hypothetical: it bit `20260512000000_trading_environment`, and
 * again on 2026-08-09 with `20260809000000_analyst_min_position_size`, where
 * the production deploy went READY ~2 minutes before the column was added by
 * hand. Only the late hour kept it from taking down the morning cron.
 *
 * Ordering is the whole point: Vercel builds, THEN promotes. Running the
 * migration during the build means the schema is in place before the new code
 * ever serves a request, and a failed migration fails the build instead of
 * silently shipping code that cannot talk to its own database.
 *
 * Which environments run it
 * -------------------------
 * PRODUCTION ONLY (`VERCEL_ENV === "production"`).
 *
 * Preview deployments are deliberately skipped. Previews build from unmerged
 * PR branches but point at the SAME production database — letting them
 * migrate would apply unreviewed, unmerged schema changes to prod the moment
 * someone opened a PR. The tradeoff is understood and correct: a preview of a
 * PR that adds a migration will render errors for the new columns until the PR
 * merges. A broken preview is the cheap failure; a prod schema mutated by an
 * abandoned branch is the expensive one.
 *
 * Local `npm run build` is skipped too (no VERCEL_ENV) — local schema work
 * goes through the normal prisma workflow, not a build side effect.
 *
 * Connection
 * ----------
 * `prisma.config.ts` points migrations at `DIRECT_URL`. This must NOT be the
 * runtime `DATABASE_URL`: that one is Supabase's transaction pooler (port
 * 6543), which cannot hold the session-level advisory lock `migrate deploy`
 * takes, so migrations hang or fail there. Use either the direct connection
 * (`db.<ref>.supabase.co:5432`) or the SESSION pooler
 * (`aws-0-<region>.pooler.supabase.com:5432`). The session pooler is the safer
 * pick for Vercel: the direct host is IPv6-only unless the project has the
 * IPv4 add-on, and a build container without IPv6 egress cannot reach it.
 *
 * Rollback note
 * -------------
 * Rolling back a deployment rolls back CODE, not the schema. Additive
 * migrations (new nullable/defaulted columns — nearly all of ours) are safe
 * under rollback because old code simply ignores the new column. A
 * destructive migration (DROP/RENAME/NOT NULL without default) is NOT: rolling
 * back leaves old code querying something that no longer exists. Ship
 * destructive changes as an expand/contract pair across two deploys.
 */

import { spawnSync } from "node:child_process";
import { config as loadEnvFile } from "dotenv";

// Mirror prisma.config.ts, which loads .env.local before reading DIRECT_URL.
// Without this the precondition check below would disagree with the URL Prisma
// actually resolves — it would "fail" locally on a machine that is configured
// perfectly well. On Vercel there is no .env.local, this is a no-op, and the
// project's environment variables win (dotenv never overrides process.env).
loadEnvFile({ path: ".env.local", quiet: true });

const vercelEnv = process.env.VERCEL_ENV ?? null;

if (vercelEnv !== "production") {
  console.log(
    `[deploy-migrate] skipped — VERCEL_ENV=${vercelEnv ?? "(unset, local build)"}; ` +
      `migrations run on production builds only.`,
  );
  process.exit(0);
}

const migrationUrl = process.env.DIRECT_URL;

if (!migrationUrl) {
  console.error(
    [
      "[deploy-migrate] DIRECT_URL is not set on this production build.",
      "",
      "Migrations cannot run, and shipping code whose migrations have not been",
      "applied is exactly the outage this step exists to prevent — so the build",
      "is failing on purpose rather than deploying a broken site.",
      "",
      "Fix: add DIRECT_URL to the Vercel project's Production environment.",
      "  - Session pooler (recommended on Vercel — reachable over IPv4):",
      "      postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres",
      "  - Direct connection (IPv6-only unless the IPv4 add-on is enabled):",
      "      postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres",
      "",
      "Do NOT reuse DATABASE_URL: it is the transaction pooler on port 6543 and",
      "cannot hold the advisory lock `prisma migrate deploy` requires.",
    ].join("\n"),
  );
  process.exit(1);
}

// Log the target without leaking credentials.
try {
  const parsed = new URL(migrationUrl);
  console.log(
    `[deploy-migrate] applying pending migrations → ${parsed.hostname}:${parsed.port || "5432"}`,
  );
  if (parsed.port === "6543") {
    console.warn(
      "[deploy-migrate] WARNING: port 6543 is Supabase's TRANSACTION pooler. " +
        "`migrate deploy` needs a session-capable connection (5432) and will " +
        "likely fail or hang here.",
    );
  }
} catch {
  console.log("[deploy-migrate] applying pending migrations (URL unparseable, continuing)");
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`[deploy-migrate] failed to start prisma: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    `[deploy-migrate] prisma migrate deploy exited ${result.status}. ` +
      "Failing the build — the schema is not in the state this code expects.",
  );
  process.exit(result.status ?? 1);
}

console.log("[deploy-migrate] migrations up to date.");
