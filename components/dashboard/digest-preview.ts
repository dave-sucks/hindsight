/**
 * digest-preview.ts — the two pure rules behind the homepage digest card:
 * which tab it opens on, and the plain-prose preview of a digest's markdown.
 */

import type { LatestDigest } from '@/lib/actions/digest.actions';

export type DigestTab = 'portfolio' | 'market';

/** The tab the card opens on: whichever digest was written last (the market
 *  digest in the morning, the portfolio digest after 8 PM). With only one, that
 *  one; with neither, Portfolio. */
export function openingDigestTab(
  portfolio: LatestDigest | null | undefined,
  market: LatestDigest | null | undefined,
): DigestTab {
  if (!market) return 'portfolio';
  if (!portfolio) return 'market';
  return Date.parse(market.createdAt) > Date.parse(portfolio.createdAt) ? 'market' : 'portfolio';
}

/** A digest's markdown as plain prose for the card's preview: no heading marks,
 *  no links or bare URLs, no source citations like "([apnews.com](https://…))". */
export function stripMarkdown(md: string): string {
  return md
    .replace(/\s*\((?:\s*\[[^\]]*\]\([^)]*\)\s*[,;·]?)+\)/g, '') // ([site](url)) citations
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                      // [text](url) → text
    .replace(/https?:\/\/\S+/g, '')                               // bare URLs
    .replace(/^#+\s+(.*?)\s*$/gm, (_, h: string) => (/[.!?:]$/.test(h) ? h : `${h}.`)) // "### Title" → "Title."
    .replace(/\*\*([^*]+)\*\*/g, '$1')                            // **bold**
    .replace(/\*([^*]+)\*/g, '$1')                                // *italic*
    .replace(/`[^`]*`/g, '')                                      // code
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
