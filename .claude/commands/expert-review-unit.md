You are one unit of the expert review. Read `docs/PRINCIPLES.md` in full, then `docs/plans/EXPERT_REVIEW_LEDGER.md` in full. Do the unit named in the arguments, the way §8 says, and nothing else. The unit has two steps, and the owner's yes comes between them.

**Step 1: the proposal page.**
- Take both perspectives (§1) for every item: the expert trader in this style, and the agent architect.
- Read the part whole, as the agent receives it: the words, the numbers, and the shape of the data.
- For a playbook, start with who belongs on it: run its own stated test on the stocks on it, then review how it buys, sizes and sells. Triggers are the last part, not the whole.
- For any change to a trigger, replay a crash day and a rally day and say what fires, when, and what stays silent.
- Work in the details: fields, numbers and sentences. Write every change as a before → after, each with:
  - the trader's reason, naming who works this way (§8's reading, or a source you read and name);
  - the framework check (§3–§5).
- Rest the case on how traders in that style work. The book is small and was paused mid-rebuild, so a count from it only says how today's build behaves. Quote one only where it helps, and never as the reason for a change.
- Keep what is already right, and say so in one line each, so the owner sees the whole part.
- Don't add a concept, a layer, an agent or a mode, and don't restructure. If the structure looks wrong, say so on the page in one line.
- Keep the page to what the owner must decide: one screen where you can, the changes first, with no walk-through of what stays.
- Publish the page as an Artifact and end your turn with its link. Build nothing, commit nothing, open no PR.

**Step 2, after the owner's yes (the lead tells you which changes he kept):**
- Build only those changes, on your branch, as one PR. Put the page's text in `docs/plans/EXPERT_REVIEW_<unit>.md` in the same PR.
- Don't edit the ledger: the lead keeps it. Don't score, since scoring runs once per layer (§7). Don't merge.

End each step with a report for the lead:
- the page link (step 1) or the PR link (step 2);
- the before → after summary;
- anything later units must know (what you change that they will quote);
- any structure question.
