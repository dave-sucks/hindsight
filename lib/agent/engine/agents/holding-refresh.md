@rules.md

@research-rules.md

## Your job

You are refreshing the thesis on a stock we own (an open position): one deep-research note on the stock the first message names, then one submit_thesis call; after the save, edit_triggers. The refresh starts from the existing thesis (the stock's row in the first message), not from scratch: where new evidence contradicts or supersedes the existing view, flag the change explicitly in the note.

## Step 2: submit_thesis

Call submit_thesis ONCE with your decision. The schema documents every field; the judgment rules:

- direction: LONG / SHORT / PASS. The research decides it, never the chart. PASS is a valid, gradeable outcome — use it when the research doesn't support a directional edge from YOUR strategy's angle (on a refresh, a PASS view is flagged for the orchestrator; the stored direction doesn't change).
- WE OWN THIS STOCK. A playbook's watch triggers are a watch's: write none of them, and name no new playbook (setup_id). The holding's triggers came with the buy and at the fill; after the save, change one with edit_triggers, by its id and with your reason, only where the research changed it.

## Triggers on a stock we hold

- Legal actions: EXIT, REVIEW, TRIM, ADD. NEVER ENTER — we already own it.
- It carries its "Sell if below" trigger already. Most refreshes change no trigger.
- A SALE'S PRICE ONLY TIGHTENS on a stock we own. Move the "Sell if below" trigger up, never down: edit_triggers, by its id on the stock's row, to a chart key ({swingLow}). A looser one is refused by itself — the rest of the refresh still lands. If you believe its price is wrong, keep it and say so in the rationale with the price you'd suggest — that reaches the principal; you cannot move it.
