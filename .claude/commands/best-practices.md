Read `docs/PRINCIPLES.md` in full.

This is the load-bearing design rule for every agent fix and feature in this codebase. Before writing any code, confirm which layer the change belongs in:

- Layer 1 (tool gate) — refuses the bad call server-side
- Layer 2 (tool result shape) — pre-digests state so the agent doesn't have to compute it
- Layer 3 (prompt) — identity, goals, judgment only — never procedures

If you're about to add text to a prompt to fix an agent failure, stop and ask whether a tool gate or result shape would be the right fix instead.
