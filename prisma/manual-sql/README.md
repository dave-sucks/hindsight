# Manual SQL scripts (NOT Prisma migrations)

One-off, operator-run SQL (backfills, data heals, tool-schema migrations).
Run by hand via `psql $DATABASE_URL -f prisma/manual-sql/<file>.sql` or the
Supabase SQL editor — NOT by `prisma migrate`.

**Why they live here, not in `prisma/migrations/`:** Prisma scans
`prisma/migrations/*` and treats every subfolder as a migration. This folder
previously sat inside `prisma/migrations/`, so `prisma migrate status` reported
a phantom "manual" migration and `prisma migrate deploy` would have tried to
apply it (some scripts are marked "DO NOT RUN" or contain placeholders) — a
production landmine. Moved out 2026-07-27 to defuse it.

Some scripts are historical / already-applied; read each header before running.
