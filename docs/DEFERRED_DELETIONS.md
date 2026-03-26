# Deferred Deletions — Post-Monitor Migration

These items were NOT deleted in the Monitor migration because they still have
data in the database or are referenced by code that wasn't in scope. They should
be deleted once the Monitor system is verified working end-to-end.

## Prisma Models (keep in schema, do NOT drop tables yet)

- `IntelligenceQuery` — replaced by Monitor (type=SEARCH). Migration copied all
  rows. No code writes to this table anymore. Table can be dropped after verifying
  all search monitors work correctly for 1+ week.

- `Source` — replaced by Monitor (type=DOMAIN). Migration copied all rows.
  **BLOCKER:** `Artifact.sourceId` has a FK to Source. Need to either migrate
  Artifact to reference Monitor, or keep Source until Artifacts are reworked.

- `SourcePack` — replaced by Monitor with analystId. No code reads or writes
  this table anymore. Can be dropped immediately after verifying domain monitors
  work.

- `SourcePackSource` — join table for SourcePack. Same as above.

- `MonitorCheckpoint` — referenced Source. May need to be reworked or dropped
  once Source is dropped.

## AgentConfig Fields

- `primarySourcePackId` — FK to SourcePack. No code reads this anymore. Can be
  removed from schema after SourcePack table is dropped.

## Prisma Schema Comments

- The `Source`, `SourcePack`, `SourcePackSource` models should have `@deprecated`
  comments added if we keep them temporarily.

## API Routes (ALREADY DELETED)

- ✅ `/api/intelligence/queries/route.ts` — deleted
- ✅ `/api/intelligence/sources/route.ts` — deleted
- ✅ `/api/intelligence/source-packs/route.ts` — deleted

## Seed Data

- The 3 seed source packs ("Firm Market Pack", "Earnings Play Pack",
  "Trend Chaser Pack") in `scripts/seed-intelligence.ts` should be removed
  or updated to create Monitor rows instead.

## Pipeline Log Component

- `components/intelligence/pipeline-log.tsx` — still exists but the Pipeline
  tab was removed from the intelligence page. The component has the job trigger
  buttons. Either re-expose triggers somewhere (monitors tab? settings?) or
  delete the component. Currently orphaned.

## Old Inngest Function Names

- The Inngest function IDs (`firm-market-sweep`, `source-pack-monitor`) use
  old naming. These CANNOT be renamed without losing job history in Inngest
  dashboard. Leave as-is — only user-facing labels matter.
