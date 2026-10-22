/**
 * The research brief as an email block, under the proposal's trade card.
 * Same palette as the card (TRADE_CARD_COLORS); every fact keeps its date and
 * a link to its source.
 */

import { TRADE_CARD_COLORS as C, escapeHtml } from "@/lib/emails/trade-card";
import {
  actionLine,
  failureLines,
  ratingsLine,
  socialLine,
  targetsLine,
  type BriefSource,
  type ResearchBriefPayload,
} from "@/lib/research/brief-types";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function cite(sources: BriefSource[], ids: number[], date: string | null): string {
  const links = ids
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is BriefSource => !!s && /^https?:\/\//.test(s.url) && !!host(s.url))
    .map((s) => `<a href="${escapeHtml(s.url)}" style="color:${C.textMuted};">${escapeHtml(host(s.url)!)}</a>`);
  const bits = [...(date ? [escapeHtml(shortDate(date))] : []), ...links];
  return bits.length ? ` <span style="color:${C.textFaint};">— ${bits.join(", ")}</span>` : "";
}

const p = (html: string, color: string = C.textPrimary) =>
  `<p style="margin:0 0 6px;font-size:13px;line-height:1.55;color:${color};">${html}</p>`;
const label = (text: string) =>
  `<p style="margin:12px 0 4px;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${C.textFaint};">${text}</p>`;

export function briefEmailHtml(b: ResearchBriefPayload): string {
  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.textFaint};">Research brief</p>`);
  if (b.synthesis) parts.push(p(escapeHtml(b.synthesis)));

  parts.push(label("Why it moved"));
  if (b.whyItMoved.length === 0) parts.push(p("No company news found for the recent move.", C.textMuted));
  for (const c of b.whyItMoved.slice(0, 4)) parts.push(p(`${escapeHtml(c.text)}${cite(b.sources, c.sourceIds, c.date)}`));

  parts.push(label("Wall Street"));
  const ws: string[] = [];
  if (b.ratings) ws.push(p(`${escapeHtml(ratingsLine(b.ratings))} <span style="color:${C.textFaint};">— Finnhub, ${escapeHtml(b.ratings.period)}</span>`));
  if (b.targets) ws.push(p(`Price targets: ${escapeHtml(targetsLine(b.targets))}${cite(b.sources, b.targets.sourceIds, b.targets.asOf)}`));
  for (const a of b.analystActions.slice(0, 4)) ws.push(p(`${escapeHtml(actionLine(a))}${cite(b.sources, a.sourceIds, a.date)}`));
  parts.push(...(ws.length ? ws : [p("No analyst ratings or targets found.", C.textMuted)]));

  if (b.social) {
    parts.push(label("On X"));
    parts.push(p(escapeHtml(socialLine(b.social))));
    for (const post of b.social.posts.slice(0, 3)) {
      parts.push(p(`@${escapeHtml(post.handle)}: ${escapeHtml(post.excerpt)} <a href="${escapeHtml(post.url)}" style="color:${C.textMuted};">post</a>`, C.textMuted));
    }
  }

  const failed = failureLines(b);
  if (failed.length) parts.push(`<p style="margin:10px 0 0;font-size:12px;color:${C.textFaint};">${failed.map(escapeHtml).join("<br>")}</p>`);

  return `<div style="margin:10px 0 0;background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:10px;padding:12px 14px;">${parts.join("")}</div>`;
}
