/**
 * The proposal card's note: while the analyst writes up an Auto trade, one
 * shimmering line in the app's loading style; then the note, three lines.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalNote, WRITING_LABEL } from "./proposal-note";

const LINE = 'Your "Sell if below $196" came true. It\'s set to Auto-sell.';
const NOTE = "Palantir is down modestly today to about $197, but the fresh company news is still supportive.";

describe("the proposal card's note", () => {
  it("while the write-up is coming: only the shimmering line, never the placeholder", () => {
    const html = renderToStaticMarkup(createElement(ProposalNote, { orderId: "o1", reason: LINE, writing: true }));
    expect(WRITING_LABEL).toBe("Writing a summary for this proposal");
    expect(html).toContain("shimmer-text");
    expect(html).toContain(WRITING_LABEL);
    expect(html).not.toContain("came true");
  });
  it("once written: the analyst's note, three lines with a click for the rest", () => {
    const html = renderToStaticMarkup(createElement(ProposalNote, { orderId: "o1", reason: NOTE, writing: false }));
    expect(html).toContain(NOTE);
    expect(html).toContain("line-clamp-3");
    expect(html).not.toContain(WRITING_LABEL);
  });
});
