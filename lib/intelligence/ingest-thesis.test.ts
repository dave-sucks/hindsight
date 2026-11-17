/**
 * The paste-a-thesis path lands what its own instructions teach.
 *
 * A new watch can't carry a sale, so the line where the setup is over is a
 * STOP_WATCHING, never an EXIT. The ingest instructions kept teaching EXIT, so
 * every pasted thesis with a floor was refused.
 *
 * The JSON below is read out of docs/prompts/INGEST_THESIS.md itself (the §A
 * contract and the worked example), so the doc and the save can't drift apart
 * again. Each goes through what `ingestThesis` does: `thesisSchema` with its
 * provenance defaults, then `record_thesis` as an ingested mint.
 */
import fs from "node:fs";
import path from "node:path";
import { actionProblem } from "@/lib/agent/triggers/condition/actions";
import { replayTool, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/** The ```json blocks of the doc, with the §A blockquote marker stripped. */
function jsonBlocks(md: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const fence = /^(?:> )?```json\n([\s\S]*?)\n(?:> )?```$/gm;
  for (const m of md.matchAll(fence)) {
    out.push(JSON.parse(m[1].replace(/^> ?/gm, "")));
  }
  return out;
}

const [CONTRACT, WORKED] = jsonBlocks(read("docs/prompts/INGEST_THESIS.md"));

type Trig = { predicate: Record<string, unknown>; action: string; rationale: string };

/** The tool module's own schema, loaded the way the replay loads the tool: against a doubled database. */
async function loadSchema() {
  let schema: typeof import("@/lib/agent/tools/record-thesis").thesisSchema | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    schema = (await import("@/lib/agent/tools/record-thesis")).thesisSchema;
  });
  return schema!;
}

/** What the ingest does to a paste before record_thesis sees it. */
async function asIngested(json: Record<string, unknown>) {
  const parsed = (await loadSchema()).safeParse({
    source_kind: "WEB_SEARCH",
    source_rationale: "External chat research, operator-curated via thesis-ingest.",
    ...json,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

async function ingest(json: Record<string, unknown>) {
  return replayTool("record-thesis", "recordThesis", {
    seed: { agentConfig: [agentConfigRow({})], account: [accountRow()] },
    ctx: { runMode: "EXTERNAL_INGEST", analystId: REPLAY_ANALYST_ID, forceWatchingMint: true },
    args: await asIngested(json),
    // Above the $280 pullback buy, so the buy has not already happened.
    quotes: { AVGO: 312 },
  });
}

describe("the ingest instructions: where the setup is over is a Stop watching line", () => {
  it.each([
    ["the §A contract", CONTRACT],
    ["the worked example", WORKED],
  ])("%s lands a WATCHING thesis with its buy and its Stop watching line", async (_name, json) => {
    expect((json.triggers as Trig[]).map((t) => t.action)).toEqual(["ENTER", "STOP_WATCHING"]);

    const { refused, refusal, crashed, db } = await ingest(json);
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    expect(crashed).toBe(false);

    const thesis = db.store.thesis.find((t) => t.ticker === "AVGO");
    expect(thesis?.status).toBe("WATCHING");
    const stored = thesis?.triggers as { action: string; predicate?: unknown; condition?: unknown }[];
    expect(stored.map((t) => t.action).sort()).toEqual(["ENTER", "STOP_WATCHING"]);
    // Read on the close: "Stop watching if below $245 · only on the close".
    const stop = stored.find((t) => t.action === "STOP_WATCHING");
    expect(JSON.stringify(stop)).toContain('"close":true');
    expect(JSON.stringify(stop)).toContain("245");
  });

  it("refuses the old version, a floor written as EXIT, and says to use STOP_WATCHING", async () => {
    const old = {
      ...WORKED,
      triggers: (WORKED.triggers as Trig[]).map((t) =>
        t.action === "STOP_WATCHING"
          ? { predicate: { watch: "price", is: "below", value: 245 }, action: "EXIT", rationale: t.rationale }
          : t,
      ),
    };
    const { refused, refusal, db } = await ingest(old);
    expect(refused).toBe(true);
    expect(refusal?.message).toContain("STOP_WATCHING");
    expect(refusal?.message).toContain("Stop watching if below $X");
    expect(db.store.thesis.filter((t) => t.ticker === "AVGO")).toHaveLength(0);
  });

  it("the MCP server and its smoke example offer only actions a new watch can carry", () => {
    const server = read("mcp/thesis-ingest/src/server.mjs");
    const offered = [...(server.match(/action: z\.enum\(\[([^\]]*)\]\)/)?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(offered).toEqual(expect.arrayContaining(["ENTER", "STOP_WATCHING"]));
    for (const a of offered) expect(actionProblem(a, { held: false })).toBeNull();

    const smoke = read("mcp/thesis-ingest/src/smoke.mjs");
    const sent = [...smoke.matchAll(/action: "([A-Z_]+)"/g)].map((m) => m[1]);
    expect(sent).toEqual(["ENTER", "STOP_WATCHING"]);
  });
});
