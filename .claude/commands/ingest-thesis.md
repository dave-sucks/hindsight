Read `docs/prompts/INGEST_THESIS.md` and follow the instructions there.

Short version (you PRODUCE the research prompt for the operator to paste into a flat-rate
ChatGPT/claude.ai chat — you do NOT research or write to the DB):
1. Args are `<Analyst name> <TICKER…>`. If the analyst isn't given, ask which one (valid:
   Secular Compounder, Catalyst Event PM, PEAD Specialist, Momentum Breakout).
2. Read `docs/prompts/INGEST_THESIS.md`. Assemble the paste block FROM it: **§A The house
   format** (the JSON contract) + the matching **§B per-analyst research brief** + the ticker(s).
3. Optionally pull the skip-list — `Thesis` WATCHING/HOLDING/PROMOTED for that analyst — so you
   don't re-source a name already covered.
4. Print the assembled block for the operator to copy into the flat-rate chat. The chat emits
   the JSON; the operator pastes it into `/intelligence/ingest`. The endpoint validates +
   persists at zero LLM cost and generates the triggers.
5. You write prompts only. No DB writes, no minting. (The mint happens via the paste UI.)
