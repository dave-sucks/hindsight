/**
 * Instructions are markdown files (lib/agent/engine/agents/*.md), and the
 * analyst, the playbooks and the stock's situations are facts the record
 * places in its instructions. This was a move, not an edit: every agent, on
 * every engine fixture case and on its sample day, is sent the same text,
 * character for character, as main before the move
 * (./__fixtures__/requests.golden.json, hashed from ./__fixtures__/sent-requests.ts
 * at d510d495).
 *
 * Reading context by subject (lib/agent/context/) changed the requests
 * CHANGED names, each for its reason; ./three-parts.engine.test.ts pins
 * each change part by part. Every other request is main's.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import GOLDEN from "./__fixtures__/requests.golden.json";
import { sentRequests } from "./__fixtures__/sent-requests";
import { AGENTS } from "./agents";
import { INSTRUCTIONS_DIR, instructionText } from "./instructions";
import { isFile, ownFile, SHARED_FILES } from "./types";
import { DIGEST_CHARS } from "./agents/market-reviewer";
import { SENDS_A_RUN } from "./agents/discovery";
import { WEB_SEARCH_MAX_USES } from "./agents/writer";
import { PROPOSALS_A_RUN } from "@/lib/agent/portfolio-manager/limits";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const BOOK = "the morning run's book is in its first message, so its first step reads it there";
const MARKET_NUMBERS = "the post-trade write-up reads the market numbers alone of the Market and portfolio reads, as every run about a thesis does";
const NO_EMPTY_PART = "an analyst with no playbooks gets no playbooks part (it was an empty one: a stray blank line)";
const CHANGED: Record<string, string> = {
  "morning.quiet": BOOK,
  "morning.full": BOOK,
  "morning.snapshot_unread": BOOK,
  "morning.filings_unread": BOOK,
  "sample.morning_run": BOOK,
  "trigger.auto_sale": MARKET_NUMBERS,
  "sample.post_trade_writeup": MARKET_NUMBERS,
  "writer.mint_plain": NO_EMPTY_PART,
  "writer.mint_notes_idea": NO_EMPTY_PART,
  "writer.refresh_seed": NO_EMPTY_PART,
  "writer.refresh_promoted": NO_EMPTY_PART,
};

describe("instructions are markdown files: a move, not an edit", () => {
  const sent = sentRequests();

  it("covers every case main was hashed on", () => {
    expect(Object.keys(sent).sort()).toEqual(Object.keys(GOLDEN.hashes).sort());
  });

  it.each(Object.keys(GOLDEN.hashes).filter((n) => !CHANGED[n]))("%s is sent what main sent, character for character", (name) => {
    expect(hash(sent[name])).toBe((GOLDEN.hashes as Record<string, string>)[name]);
  });

  it.each(Object.entries(CHANGED))("%s changed: %s", (name) => {
    expect(hash(sent[name])).not.toBe((GOLDEN.hashes as Record<string, string>)[name]);
  });
});

describe("the instruction files", () => {
  it("each agent has one of its own, and every file it names exists; no file goes unused", () => {
    const named = new Set<string>();
    for (const r of AGENTS) {
      const own = r.instructions.filter((e) => isFile(e) && !(SHARED_FILES as readonly string[]).includes(e));
      expect([r.id, own.length]).toEqual([r.id, 1]);
      expect([r.id, ownFile(r)]).toEqual([r.id, `${r.id.replace(/_/g, "-")}.md`]);
      for (const e of r.instructions) if (isFile(e)) named.add(e);
    }
    expect(readdirSync(INSTRUCTIONS_DIR).filter((f) => f.endsWith(".md")).sort()).toEqual([...named].sort());
  });

  it("is plain text: no ${…} left from a template, and each ends in one newline", () => {
    for (const f of readdirSync(INSTRUCTIONS_DIR).filter((x) => x.endsWith(".md"))) {
      const raw = readFileSync(path.join(INSTRUCTIONS_DIR, f), "utf8");
      expect([f, raw.includes("${")]).toEqual([f, false]);
      expect([f, raw.endsWith("\n") && !raw.endsWith("\n\n")]).toEqual([f, true]);
    }
  });

  it("the numbers written into the text are the ones code enforces", () => {
    expect(instructionText("portfolio-manager.md")).toContain(`At most ${PROPOSALS_A_RUN} proposals a run`);
    expect(instructionText("discovery.md")).toContain(`Send at most ${SENDS_A_RUN} a run`);
    expect(instructionText("research-rules.md")).toContain(`(up to ${WEB_SEARCH_MAX_USES} searches)`);
    expect(instructionText("market-reviewer.md")).toContain(`Each section is about ${Math.round(DIGEST_CHARS / 6).toLocaleString("en-US")} characters`);
    expect(instructionText("market-reviewer.md")).toContain(`About ${DIGEST_CHARS.toLocaleString("en-US")} characters in all`);
  });
});
