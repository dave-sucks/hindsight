/**
 * The yardstick's rules: each quotes a sentence the agent is given today, and
 * each catches what it is for on made-up runs and passes one that keeps it.
 */
import { AGENTS } from "@/lib/agent/engine/agents";
import { isOwn, type AgentId } from "@/lib/agent/engine/types";
import { brokenRules, holdingsOf, INVENTED_QUOTES, reviewerInvented, RULES, waitingOf, type RuleRun } from "./rules";

/** An agent's own instructions as it is sent them today. */
function instructionsOf(agent: AgentId): string {
  const record = AGENTS.find((a) => a.id === agent)!;
  const input = { now: new Date("2026-11-17T15:00:00Z"), environment: "LIVE" as const };
  return record.instructions.filter(isOwn).map((p) => (typeof p.text === "string" ? p.text : p.text(input) ?? "")).join("\n\n");
}

const PORTFOLIO = [
  "The account, Tue, Nov 17 at the close",
  "Value $100,000.00 · cash $40,000.00 (40.0% of the account)",
  "",
  "Holdings (2), largest first:",
  "- NWND: 50 shares at $200.00 = $10,000 (10.0%) · day −1.0% (−$100) · since bought at $180.00: +11.1% (+$1,000) · conviction HIGH · Secular Compounder",
  "- CNTS: 100 shares at $50.00 = $5,000 (5.0%) · day +2.0% (+$100) · since bought at $60.00: −16.7% (−$1,000) · conviction LOW · PEAD Specialist",
  "",
  "Bought or sold on Tue, Nov 17: nothing.",
  "",
  "Waiting for the owner's approval (proposals, not trades, until approved):",
  "- Sell 100 shares of CNTS, proposed 3 times since Thu, Nov 12 · PEAD Specialist. Its reason: \"Contoso keeps slipping.\"",
  "- Buy 20 shares of FABK, proposed Mon, Nov 16 · Secular Compounder. Its reason: \"Fabrikam is back at its buy price.\"",
].join("\n");

const run = (over: Partial<RuleRun>): RuleRun => ({ calls: [], reply: "", shown: PORTFOLIO, portfolio: PORTFOLIO, ...over });
const ids = (agent: AgentId, r: RuleRun) => brokenRules(agent, r).map((b) => b.rule);

describe("the yardstick's rules", () => {
  it.each(RULES.map((r) => [r.id, r] as const))("%s quotes a sentence its agent is sent today", (_id, rule) => {
    expect(instructionsOf(rule.agent)).toContain(rule.quote);
  });

  it("the sentences behind 'nothing invented' are sent today", () => {
    for (const q of Object.values(INVENTED_QUOTES)) expect(instructionsOf(q!.agent)).toContain(q!.quote);
  });

  it("reads the holdings and the proposals waiting off the snapshot", () => {
    expect(holdingsOf(PORTFOLIO)).toEqual(["NWND", "CNTS"]);
    expect(waitingOf(PORTFOLIO)).toEqual([{ side: "SELL", ticker: "CNTS" }, { side: "BUY", ticker: "FABK" }]);
  });

  describe("the Portfolio Manager", () => {
    const thesisTickers = new Map([["t_nwnd", "NWND"], ["t_cnts", "CNTS"], ["t_fabk", "FABK"], ["t_wdgt", "WDGT"]]);
    const WRITEUP = "### Where the money is\nTwo bets.\n### The ranking\n1. NWND, growing. 2. FABK, ready. 3. CNTS, slipping.\n### What I did\nI proposed trimming NWND: too big for how sure we are.\n### Open questions\nNone.\n### What the account needs\nLess tech.";

    it("a trim with its note and a write-up that says so keeps every rule", () => {
      const calls = [{ toolName: "manage_position", input: { symbol: "NWND", action: "partial_close" } }, { toolName: "update_thesis", input: { thesis_id: "t_nwnd", rationale: "Too big." } }];
      expect(ids("portfolio_manager", run({ calls, reply: WRITEUP, thesisTickers }))).toEqual([]);
    });

    it("catches a fourth proposal, a trade with no note, a note on its own, a repeat of a waiting trade and a stray stock-data read", () => {
      const calls = [
        { toolName: "get_stock_data", input: { ticker: "BLUE" } },
        { toolName: "close_position", input: { ticker: "CNTS" } },
        { toolName: "place_trade", input: { ticker: "FABK" } },
        { toolName: "update_thesis", input: { thesis_id: "t_fabk", rationale: "Ready." } },
        { toolName: "manage_position", input: { symbol: "NWND", action: "partial_close" } },
        { toolName: "update_thesis", input: { thesis_id: "t_nwnd", rationale: "Too big." } },
        { toolName: "place_trade", input: { ticker: "WDGT" } },
        { toolName: "update_thesis", input: { thesis_id: "t_wdgt", rationale: "Better use." } },
      ];
      const broken = brokenRules("portfolio_manager", run({ calls, reply: WRITEUP, thesisTickers }));
      expect(broken.map((b) => b.rule).sort()).toEqual(["pm.note_with_trade", "pm.stock_data", "pm.three", "pm.waiting", "pm.waiting", "pm.what_i_did"].sort());
      expect(broken.find((b) => b.rule === "pm.three")!.problem).toBe("4 proposals");
    });

    it("a note on a stock it sent to research is allowed; one on a stock it only read is not", () => {
      const calls = [{ toolName: "dispatch_thesis_research", input: { existing_thesis_id: "t_wdgt", mode: "refresh" } }, { toolName: "update_thesis", input: { thesis_id: "t_wdgt", rationale: "Out of date." } }, { toolName: "update_thesis", input: { thesis_id: "t_nwnd", rationale: "Fine." } }];
      const broken = brokenRules("portfolio_manager", run({ calls, reply: WRITEUP.replace("I proposed trimming NWND: too big for how sure we are.", "I sent WDGT to research."), thesisTickers }));
      expect(broken.map((b) => b.problem)).toEqual(["a note on NWND, which it neither traded nor sent to research", '"What I did" leaves out NWND']);
    });

    it("a write-up missing a heading, out of order or leaving a holding out of the ranking", () => {
      expect(ids("portfolio_manager", run({ reply: "### The ranking\nNWND.\n### Where the money is\nx\n### What I did\nNothing.\n### Open questions\nx\n### What the account needs\nx", thesisTickers }))).toEqual(["pm.writeup_headings", "pm.ranking"]);
      expect(brokenRules("portfolio_manager", run({ reply: "### Where the money is\nx", thesisTickers }))[0].problem).toBe('no "### The ranking", "### What I did", "### Open questions", "### What the account needs"');
    });
  });

  describe("the Market Reviewer", () => {
    const NUMBERS = "- S&P 500 (SPY) $732.44 −1.01% · Nasdaq 100 (QQQ) $656.95 −0.73%.\n- Sectors: XLE energy −0.52%, XLU utilities −1.59%.";
    const link = (n: number) => `([source](https://example.com/${n}))`;
    const DIGEST = [
      "### Market overview",
      `The S&P 500 fell 1.01% and the Nasdaq 100 0.73% as yields rose to 4.6% ${link(1)}. My interpretation is that rates drove it.`,
      "### Sector developments",
      `Energy held up best, XLE down 0.52% ${link(2)}.`,
      "### Major developments",
      `A chipmaker guided sales to $12 billion ${link(3)}.`,
      "### Implications for your portfolio",
      `NWND's supplier raised prices ${link(4)}. CNTS fell with its group.`,
      "### What deserves attention",
      "Nothing new since yesterday.",
      "### Upcoming events",
      `- Nov 20: jobs report ${link(5)}`,
      `- Dec 9: Fed decision ${link(6)}`,
    ].join("\n");
    const book = ["NWND", "CNTS", "FABK"];
    const pad = (d: string) => d.replace("Nothing new since yesterday.", `Nothing new since yesterday. ${"Quiet. ".repeat(160)}`);

    it("a digest in its six sections, its numbers sourced, keeps every rule", () => {
      const r = run({ reply: pad(DIGEST), marketNumbers: NUMBERS, book, shown: `${PORTFOLIO}\n${NUMBERS}`, notes: [{ tickers: ["NWND"], text: `Its supplier raised prices ${link(7)}.`, impact: "medium", effect: "weaker" }] });
      expect(brokenRules("market_reviewer", r)).toEqual([]);
      expect(reviewerInvented(r)).toEqual([]);
    });

    it("catches an index number not its own, a word on a waiting proposal, a stock outside the book, an unlinked event and note, a short digest and an unsourced number", () => {
      const bad = DIGEST.replace("fell 1.01%", "fell 1.4%")
        .replace("CNTS fell with its group.", "CNTS fell, and the sale waiting for you looks right. WDGT jumped.")
        .replace(`- Dec 9: Fed decision ${link(6)}`, "- Dec 9: Fed decision")
        .replace("Nothing new since yesterday.", "Margins hit 31% across the group.");
      const r = run({ reply: `Here is today's digest.\n${bad}`, marketNumbers: NUMBERS, book, shown: `${PORTFOLIO}\n${NUMBERS}`, notes: [{ tickers: ["CNTS"], text: "It fell.", impact: "high", effect: "weaker" }] });
      expect(ids("market_reviewer", r).sort()).toEqual(["reviewer.book_only", "reviewer.length", "reviewer.market_numbers", "reviewer.note_linked", "reviewer.only_sections", "reviewer.upcoming_links", "reviewer.waiting"].sort());
      expect(reviewerInvented(r)).toEqual(["31%"]);
    });

    it("news on a stock whose sale is waiting is fair, and a link after a sentence's full stop is that sentence's", () => {
      const reply = pad(DIGEST).replace("CNTS fell with its group.", `Its supplier raised prices. ${link(8)} For CNTS, nothing new beyond its earnings timing and its 10-Q. ${link(9)} Revenue there grew 31%. ${link(10)}`);
      const r = run({ reply, marketNumbers: NUMBERS, book, shown: `${PORTFOLIO}\n${NUMBERS}` });
      expect(brokenRules("market_reviewer", r)).toEqual([]);
      expect(reviewerInvented(r)).toEqual([]);
    });
  });

  describe("the portfolio digest", () => {
    const GOOD = [
      "The account fell 1.0% today, and NWND did most of it.",
      "Nothing was bought or sold today.",
      "Two proposals wait for you. Selling CNTS: I'd approve it, it is down 16.7% since bought. Buying 20 shares of FABK: I would hold off until it settles.",
      "Cash is $40,000.00, 40.0% of the account. NWND is up 11.1% since bought.",
    ].join("\n\n");

    it("a digest in four paragraphs with a view on each proposal keeps every rule", () => {
      expect(brokenRules("portfolio_digest", run({ reply: GOOD }))).toEqual([]);
    });

    it("catches a proposal left out or with no view, a stock it wasn't given, a new price, cash advice and a list", () => {
      const bad = [
        "The account fell 1.0% today, and NWND did most of it, while WDGT rallied.",
        "- Nothing was bought or sold today.",
        "Selling CNTS is still waiting.",
        "Cash is $40,000.00, 40.0% of the account, and you should put it to work. NWND could reach $240.",
      ].join("\n\n");
      expect(ids("portfolio_digest", run({ reply: bad })).sort()).toEqual(["digest.cash", "digest.every_proposal", "digest.no_stock", "digest.price_level", "digest.shape", "digest.view"].sort());
    });
  });
});
