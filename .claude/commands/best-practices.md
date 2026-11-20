Read `docs/PRINCIPLES.md` in full. It is the standard for every agent change in this codebase, from the architecture down to the words in a sentence.

Before writing anything, settle two things:
- Which home the change belongs in (§3, §4), and, for a failure, which layer the fix goes in (§6): a refusal in a tool, a fact, or the instructions.
- Whether it survives both perspectives (§1): would an expert trader in this style do exactly this, and is it written the way §5 says?

If you're about to add text to an agent's instructions to fix a failure, stop and ask whether a refusal or a fact is the right fix instead.
