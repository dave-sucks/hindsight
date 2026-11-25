/**
 * The skills (lib/agent/engine/skills/*.md): one short file per situation,
 * sent as written. Each says what to find out, what can follow and what done
 * looks like; code picks the part for a stock we hold or one we watch and
 * writes none of the words.
 */
import { readdirSync } from "fs";
import { MODES } from "@/lib/agent/modes";
import { ROW_FIELDS } from "@/lib/agent/row-for-model";
import { SITUATIONS, type SituationCode } from "./situations";
import { guidanceFor, situationText, skillIndex, skillSource, SKILLS_DIR } from "./situation-skills";

const SKILLS = (Object.keys(SITUATIONS) as SituationCode[]).filter((c) => SITUATIONS[c].skill);
const file = (c: SituationCode) => skillSource(SITUATIONS[c].skill!);

describe("nine skills, one file each", () => {
  it("the nine situations with a skill, and every file in the folder is one of them", () => {
    expect(SKILLS).toEqual(["PROTECTIVE_SALE", "BUY_ARRIVES", "ADD_OR_WINNER", "REPORT", "FILING", "NEWS", "PROTECTION", "REVIEW_DUE", "SOLD_ONE_REVIEW"]);
    expect(readdirSync(SKILLS_DIR).sort()).toEqual(SKILLS.map((c) => SITUATIONS[c].skill!).sort());
    expect(skillIndex().map((x) => x.id)).toEqual(SKILLS);
  });
  it("a situation's text is in its skill file or in the table, never both", () => {
    for (const [code, s] of Object.entries(SITUATIONS)) expect([code, !!s.skill !== !!s.guidance]).toEqual([code, true]);
    expect(Object.keys(SITUATIONS).filter((c) => SITUATIONS[c as SituationCode].guidance)).toEqual(["PROMOTED_AWAITING"]);
  });
  it("none is over 1,500 characters", () => {
    for (const c of SKILLS) expect([c, file(c).length <= 1_500]).toEqual([c, true]);
  });
  it("each asks numbered questions and says what done looks like", () => {
    for (const c of SKILLS) {
      expect([c, /^1\. .+\?/m.test(file(c))]).toEqual([c, true]);
      expect([c, file(c).includes("Done: one note")]).toEqual([c, true]);
    }
  });
  it("none names a tool, a field of the row, a code, or anything for code to fill in", () => {
    // Two tools are named by an everyday verb, sell and add; a skill uses the verbs.
    const tools = new Set(Object.values(MODES).flatMap((m) => [...(m.toolAllowlist ?? [])] as string[]).filter((t) => t !== "sell" && t !== "add"));
    const fields = Object.keys(ROW_FIELDS).filter((k) => k.includes("_") || /[a-z][A-Z]/.test(k));
    expect(tools.size).toBeGreaterThan(30);
    for (const c of SKILLS) {
      const words = new Set(file(c).split(/[^A-Za-z_]+/));
      expect([c, [...tools, ...fields].filter((t) => words.has(t))]).toEqual([c, []]);
      expect([c, file(c).match(/[`{}$]\{?|\b[A-Z]{2,}_[A-Z_]+\b|\[id/g)?.filter((m) => m !== "$") ?? []]).toEqual([c, []]);
    }
  });
  it("none carries the two sentences that are refusals now: a sale that already waits, and a full analyst", () => {
    for (const c of SKILLS) expect([c, file(c).match(/already waits|proposal waiting|analyst is full|free slot|every slot/gi)]).toEqual([c, null]);
    for (const s of Object.values(SITUATIONS)) expect(s.guidance ?? "").not.toContain("proposal_waiting");
  });
});

describe("the part that fits the stock", () => {
  const HOLD = "A stock we hold.";
  const WATCH = "A stock we watch.";
  it("a holding gets the file without the watch's paragraph, a watch without the holding's; a person gets the whole file", () => {
    for (const c of ["REPORT", "FILING", "NEWS", "REVIEW_DUE"] as const) {
      const whole = situationText(c, null);
      expect(whole).toBe(file(c));
      expect([whole.includes(HOLD), whole.includes(WATCH)]).toEqual([true, true]);
      const held = situationText(c, true);
      const watched = situationText(c, false);
      expect([held.includes(HOLD), held.includes(WATCH)]).toEqual([true, false]);
      expect([watched.includes(HOLD), watched.includes(WATCH)]).toEqual([false, true]);
      // Every paragraph sent is a paragraph of the file, in the file's order: nothing is written or reworded.
      for (const sent of [held, watched]) {
        const paragraphs = whole.split("\n\n");
        expect(sent.split("\n\n").every((p) => paragraphs.includes(p))).toBe(true);
        expect(paragraphs.filter((p) => sent.split("\n\n").includes(p)).join("\n\n")).toBe(sent);
      }
    }
  });
  it("a skill for one kind of stock has that part alone: a sale, an add and a floor on a holding, a buy on a watch", () => {
    for (const c of ["PROTECTIVE_SALE", "ADD_OR_WINNER", "PROTECTION"] as const) expect([file(c).includes(HOLD), file(c).includes(WATCH)]).toEqual([true, false]);
    expect([file("BUY_ARRIVES").includes(HOLD), file("BUY_ARRIVES").includes(WATCH)]).toEqual([false, true]);
    expect(situationText("SOLD_ONE_REVIEW", false)).toBe(file("SOLD_ONE_REVIEW"));
  });
  it("one text per code in rank order: the part for the kind on the list, the whole file when the list has both", () => {
    const out = guidanceFor([
      { code: "REVIEW_DUE", held: true },
      { code: "PROTECTIVE_SALE", held: true },
      { code: "REVIEW_DUE", held: true },
      { code: "REPORT", held: false },
      { code: "FILING", held: true },
      { code: "FILING", held: false },
    ]);
    expect(Object.keys(out)).toEqual(["PROTECTIVE_SALE", "REPORT", "FILING", "REVIEW_DUE"]);
    expect(out.REVIEW_DUE).toBe(situationText("REVIEW_DUE", true));
    expect(out.REPORT).toBe(situationText("REPORT", false));
    expect(out.FILING).toBe(file("FILING"));
  });
  it("promoted to live is its text in the table, whatever the stock", () => {
    expect(situationText("PROMOTED_AWAITING", true)).toBe(SITUATIONS.PROMOTED_AWAITING.guidance);
    expect(guidanceFor([{ code: "PROMOTED_AWAITING", held: false }]).PROMOTED_AWAITING).toBe(SITUATIONS.PROMOTED_AWAITING.guidance);
  });
});

describe("what the skills say", () => {
  it("on a watch, a review, a report and news can each end in a buy: the case stronger and the playbook's buy true today", () => {
    for (const c of ["REVIEW_DUE", "REPORT", "NEWS"] as const) {
      const watch = situationText(c, false);
      expect([c, watch.includes("the case is stronger and the playbook's buy is true today: propose the buy") || watch.includes("The case is stronger and the playbook's buy is true today: propose the buy")]).toEqual([c, true]);
      expect([c, situationText(c, true).includes("propose the buy")]).toEqual([c, false]);
    }
  });
  it("news: what happened and when, which line of the case, what follows; and it never lowers a floor", () => {
    const news = file("NEWS");
    for (const words of ["1. What happened, and when?", "check it against the stock's own price and volume", "2. Which line of the case does it touch?", "Name the one line, or say it touches none", "3. What follows?", "Never lower a floor."]) expect([words, news.includes(words)]).toEqual([words, true]);
  });
  it("the review is the clock and a price worth a second look: no report, no filing, no stock without a view", () => {
    const review = file("REVIEW_DUE");
    expect(review).toContain("The review clock came due, or the price reached a level you asked to look at again.");
    expect(review.match(/report|filing|no view|write-up|Writer reads|restatement/gi)).toBeNull();
    expect(review).toContain("If you gave the same answer last time, change a trigger or say what is different now.");
  });
  it("a sale: the story or only the price, and the owner's decline is read; a floor is raised, not lowered", () => {
    expect(file("PROTECTIVE_SALE")).toContain("Go down the KPIs");
    expect(file("PROTECTIVE_SALE")).toContain("Did the owner decline this sale, or let it lapse?");
    for (const c of SKILLS) expect([c, /lower (the|a) (floor|sale price)|move the floor down|loosen/i.test(file(c).replace("Never lower a floor.", ""))]).toEqual([c, false]);
  });
  it("a report keeps its trading rules: a beat on costs, a miss with the case intact, no buy on a beat alone, no add into it", () => {
    const held = situationText("REPORT", true);
    for (const words of [
      "add nothing into the report.",
      "A miss with the case intact stays, floored under structure: say what would change your mind.",
      "A profit beat with revenue short came from costs: raise nothing on it.",
      "A beat alone is no reason to buy, nor a miss alone to sell.",
    ]) expect([words, held.includes(words)]).toEqual([words, true]);
    expect(situationText("REPORT", false)).toContain("A beat alone is no reason to buy, nor a miss alone to sell.");
  });
  it("just sold: the four ways it can end", () => {
    for (const words of ["with a buy priced off today's chart", "on a review clock", "with nothing set", "or let it go"]) expect(file("SOLD_ONE_REVIEW")).toContain(words);
  });
});
