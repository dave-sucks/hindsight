# Hindsight thesis-ingest MCP server

An MCP server that exposes one tool, **`save_thesis`**, so an assistant (Claude Desktop,
or any MCP client) can mint a Hindsight `WATCHING` thesis directly from a research
decision — no copy-paste into the web UI. It wraps the deployed
`POST /api/intelligence/thesis-ingest` endpoint; all validation, taxonomy, gating, and
**trigger generation happen server-side at zero LLM cost**. This process holds no
database connection — only the ingest URL + secret.

This is Phase 2 of `docs/plans/EXTERNAL_THESIS_INGEST.md`. The research method itself
lives in `docs/prompts/INGEST_THESIS.md` (§A house format + §B per-analyst briefs) — the
`save_thesis` field descriptions restate the contract so the assistant fills it correctly.

## Prerequisites
1. Set `THESIS_INGEST_SECRET` in Vercel (Project → Settings → Environment Variables) and
   redeploy. This is what the endpoint checks; without it the endpoint returns 401.
2. Node 18+ (uses global `fetch`).

## Install
```bash
cd mcp/thesis-ingest
npm install
```

## Configure Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) under `mcpServers`, then restart Claude Desktop:
```json
{
  "mcpServers": {
    "hindsight-thesis-ingest": {
      "command": "node",
      "args": ["/absolute/path/to/hindsight/mcp/thesis-ingest/src/server.mjs"],
      "env": {
        "HINDSIGHT_INGEST_URL": "https://your-app.vercel.app/api/intelligence/thesis-ingest",
        "THESIS_INGEST_SECRET": "the-same-secret-as-vercel"
      }
    }
  }
}
```

## Usage
In Claude Desktop, research a name for one of the analysts (Secular Compounder, Catalyst
Event PM, PEAD Specialist, Momentum Breakout — see `docs/prompts/INGEST_THESIS.md`), then
ask it to *"save this as a thesis for the Secular Compounder."* It calls `save_thesis`;
on success you get the `thesis_id`, on rejection the exact validation reason to fix and
retry. Never pass `triggers` — the platform generates them from horizon + prices.

## Smoke test (against a local dev server)
```bash
HINDSIGHT_INGEST_URL=http://localhost:3000/api/intelligence/thesis-ingest \
THESIS_INGEST_SECRET=... \
node src/smoke.mjs
```
Expect the valid payload → `{ ok: true, thesis: { thesis_id } }` and the invalid one →
`{ ok: false, error: "…conviction tier required…" }`.
