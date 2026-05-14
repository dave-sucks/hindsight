Read `docs/prompts/REVIEW_DAILY_RUN.md` and follow the instructions there.

Short version of what you're doing:
1. Read `docs/run-reviews/TEMPLATE.md` for the report shape
2. Read the most recent `docs/run-reviews/YYYY-MM-DD.md` as the prior baseline
3. Read `docs/GAPS.md` for known open issues to flag if they appear (or don't)
4. Run the SQL from the template against today's date
5. Write `docs/run-reviews/<today>.md`
6. Open one PR titled `docs(run-review): YYYY-MM-DD` — no code changes
