import { existsSync } from "node:fs";
import path from "node:path";
import { GUIDE_DIR, loadGuide } from "./guide";
import { GUIDE_ASSETS, parseDoc } from "./guide-parse";
import { DOCS_AGENTS } from "./tools";

/** The guide is read by agents in the repo and drawn by /docs from the same files, so both depend on these holding. */
describe("the guide (docs/guide)", () => {
  const guide = loadGuide();
  const docs = Object.entries(guide).filter(([slug]) => slug !== "README");
  const parsed = docs.map(([slug, source]) => ({ slug, source, doc: parseDoc(source) }));

  it("has the README and every doc the page lists", () => {
    expect(Object.keys(guide)).toContain("README");
    for (const slug of ["discovery", "writer", "morning-runs", "trigger-runs", "chat", "theses", "triggers", "analysts", "situations", "approvals", "under-the-hood"]) {
      expect(Object.keys(guide)).toContain(slug);
    }
  });

  it("opens every doc with a title and a bold lead sentence", () => {
    for (const { slug, source, doc } of parsed) {
      expect([slug, doc.title.length > 0]).toEqual([slug, true]);
      expect([slug, /^#[^\n]+\n+\*\*/.test(source.trimStart())]).toEqual([slug, true]);
    }
  });

  it("links only to docs that exist", () => {
    for (const [slug, source] of Object.entries(guide)) {
      for (const m of source.matchAll(/\]\(([\w-]+\.md)\)/g)) {
        expect([slug, m[1], existsSync(path.join(GUIDE_DIR, m[1]))]).toEqual([slug, m[1], true]);
      }
    }
  });

  it("places only pictures the page can draw, and draws every one somewhere", () => {
    const used = new Set<string>();
    for (const { slug, doc } of parsed) {
      for (const part of doc.parts) {
        if (part.kind !== "section") continue;
        for (const b of part.blocks) {
          if (b.kind !== "asset") continue;
          used.add(b.name);
          expect([slug, b.name, (GUIDE_ASSETS as readonly string[]).includes(b.name)]).toEqual([slug, b.name, true]);
          if (b.name === "tools") expect([slug, DOCS_AGENTS.some((a) => a.id === b.arg)]).toEqual([slug, true]);
        }
      }
    }
    expect(GUIDE_ASSETS.filter((a) => !used.has(a))).toEqual([]);
  });

  it("leaves no marker unread: every asset line and chat block is picked up by the parser", () => {
    for (const { slug, source, doc } of parsed) {
      const markers = (source.match(/^<!--\s*asset:/gm) ?? []).length;
      const chats = (source.match(/^```chat$/gm) ?? []).length;
      const blocks = doc.parts.flatMap((p) => (p.kind === "section" ? p.blocks : []));
      expect([slug, blocks.filter((b) => b.kind === "asset").length, blocks.filter((b) => b.kind === "chat").length]).toEqual([slug, markers, chats]);
    }
  });
});
