Read `docs/prompts/REVIEW_DISCOVERY_RUN.md` and follow the instructions there.

Short version of what you're doing:
1. Read `docs/discovery-reviews/TEMPLATE.md` for the expectations doc shape
2. Read the most recent `docs/discovery-reviews/YYYY-MM-DD-TICKER.md` as an example
3. Query `AnalystSignalRoute` to find a good anchor ticker (high signal density, uncovered, in-universe)
4. Pre-commit what the run SHOULD produce — every required field, scoring rubric, expected triggers
5. Write `docs/discovery-reviews/<YYYY-MM-DD>-<TICKER>.md`
6. After the run completes, add a `## Post-run comparison` section to the same file
7. Open one PR titled `docs(discovery-review): YYYY-MM-DD-TICKER` — no code changes
