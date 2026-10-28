/**
 * The research paragraph as an email block, under the proposal's trade card.
 * Same palette as the card (TRADE_CARD_COLORS): the paragraph and links to
 * its sources.
 */

import { TRADE_CARD_COLORS as C, escapeHtml } from "@/lib/emails/trade-card";
import { briefLinks, type ResearchBriefPayload } from "@/lib/research/brief-types";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const p = (html: string, color: string = C.textPrimary) =>
  `<p style="margin:0 0 6px;font-size:13px;line-height:1.55;color:${color};">${html}</p>`;

/** The research paragraph under the proposal's trade card, with its sources as links. */
export function briefEmailHtml(b: ResearchBriefPayload): string {
  if (!b.synthesis) return "";
  const links = briefLinks(b)
    .map((s) => ({ url: s.url, host: host(s.url) }))
    .filter((s): s is { url: string; host: string } => !!s.host)
    .slice(0, 5)
    .map((s) => `<a href="${escapeHtml(s.url)}" style="color:${C.textMuted};">${escapeHtml(s.host)}</a>`);
  const parts = [p(escapeHtml(b.synthesis))];
  if (links.length) parts.push(`<p style="margin:4px 0 0;font-size:12px;color:${C.textFaint};">${links.join(" · ")}</p>`);
  return `<div style="margin:10px 0 0;background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:10px;padding:12px 14px;">${parts.join("")}</div>`;
}
