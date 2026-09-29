/**
 * row-links-no-preload.test.ts — a row never asks for its page before it is
 * clicked (the dashboard, 2026-09-29).
 *
 * Next fetches every <Link> as it scrolls into view unless the link says
 * prefetch={false}. Between 13:59:16 and 13:59:28 ET that day the dashboard
 * fetched 23 row pages with no click (Vercel runtime logs, deployment
 * dpl_59KaiBf7BoJddDxTKZv8PcueW1pt):
 *
 *   /runs/…    six, all Activity rows (tactical runs on VST, CYTK, ABT twice,
 *              ETN, MSFT)
 *   /trades/…  seven: MU, PBH, ASML, ABT, CEG, CORT, ISRG
 *   /stocks/…  ten: five off the movers list, the pinned MIRM, ETN and ANET,
 *              and V and TRV (blocked Activity rows)
 *
 * The pages behind a row have no loading file, so the early fetch saved
 * nothing when the row was clicked.
 *
 * Each of those rows is one of two links: the Activity row in
 * DashboardClient, and the row shell every trade-shaped row renders through
 * (pinned, pending, movers — and the trades page). This reads both files and
 * fails on any <Link> in them that can fetch early.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROW_LINK_FILES = [
  "components/dashboard/DashboardClient.tsx", // the Activity row
  "components/ui/trade-row.tsx", // TradeRowShell: pinned, pending, movers
];

function readLinks(file: string): { total: number; fetchEarly: string[] } {
  const text = readFileSync(path.join(__dirname, "../..", file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attr = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) =>
    el.attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === name,
    );

  let total = 0;
  const fetchEarly: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "Link"
    ) {
      total++;
      const init = attr(node, "prefetch")?.initializer;
      const off =
        init !== undefined &&
        ts.isJsxExpression(init) &&
        init.expression?.kind === ts.SyntaxKind.FalseKeyword;
      if (!off) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const href = attr(node, "href")?.getText(source).replace(/\s+/g, " ") ?? "no href";
        fetchEarly.push(`${file}:${line} <Link ${href}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { total, fetchEarly };
}

describe("a row never fetches its page before it is clicked", () => {
  it.each(ROW_LINK_FILES)("%s: every <Link> says prefetch={false}", (file) => {
    const { total, fetchEarly } = readLinks(file);
    // The row link still lives here — otherwise this passes on nothing.
    expect(total).toBeGreaterThan(0);
    expect(fetchEarly).toEqual([]);
  });
});
