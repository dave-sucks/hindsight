-- A stock's first Activity line names the status it started in
-- ({ "status": { "from": null, "to": "WATCHING" } }, or "PASSED"): the
-- homepage reads it as "Started watching" or "Passed". Lines written before
-- carried none. Stamp the ones whose stock has changed status on no line
-- since, so the status it started in is its status now; leave the rest.
UPDATE "ThesisUpdate" u
SET "fieldChanges" = jsonb_build_object('status', jsonb_build_object('from', NULL, 'to', t.status::text))
FROM "Thesis" t
WHERE u."thesisId" = t.id
  AND u.type = 'CREATED'
  AND u."fieldChanges" = '{}'::jsonb
  AND t.status IN ('WATCHING', 'PASSED')
  AND NOT EXISTS (
    SELECT 1 FROM "ThesisUpdate" s
    WHERE s."thesisId" = u."thesisId" AND s."fieldChanges" -> 'status' IS NOT NULL
  );
