---
id: briefing
title: Briefing Agent
summary: After every run completes, a separate GPT-4o pass reviews the transcript and portfolio and writes the standup memo that gets injected into the next run's prompt.
---

The Briefing Agent is what gives your analysts continuity between sessions. It fires inline at the end of every [Daily Run](agent:agent), [Tactical Run](agent:tactical), and [Discovery Run](agent:discovery) — always as a separate GPT-4o call, never as self-reporting by the agent that just ran.

The standup it writes gets injected directly into the next run's system prompt. That's how the analyst remembers what happened yesterday, what's still unresolved, and what to watch for today.

## Step 1: Read the session

The briefing agent reads the full conversation transcript from the run that just completed — every message, tool call, and result. It also pulls the current portfolio state with live P&L and the trade outcomes from the session.

## Step 2: Write the standup

A structured 400–600 word memo covering what actually happened in the session, any strategy adjustments made, the current market posture, items to watch in the next run, unresolved issues that carried over, and any self-corrections worth noting.

The briefing is written as an external observer, not a participant. It's designed to be useful to the *next* run, not to recap the previous one for its own sake.

## Step 3: Create monitors (optional)

If the session surfaced topics that warrant ongoing tracking, the briefing agent creates zero to five short-lived search monitors with expiration dates. The next morning's [Intelligence Pipeline](agent:intelligence) picks them up automatically and runs them as part of the domain monitor step.

```writes
record_briefing — structured standup: narrative, strategy notes, posture, watch-tomorrow items, unresolved items, self-corrections
create_monitor — 0–5 short-lived search monitors with expiration dates
```
