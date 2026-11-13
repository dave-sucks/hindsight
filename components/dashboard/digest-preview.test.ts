import { openingDigestTab, stripMarkdown } from './digest-preview';
import type { LatestDigest } from '@/lib/actions/digest.actions';

const digest = (createdAt: string): LatestDigest => ({
  id: 'd', date: '2026-01-05T00:00:00.000Z', narrative: 'x', model: null, createdAt,
});

describe('openingDigestTab', () => {
  const morning = digest('2026-01-06T12:30:00.000Z'); // 7:30 AM ET
  const evening = digest('2026-01-06T01:00:00.000Z'); // the 8 PM digest, written earlier
  it('opens on the digest written last', () => {
    expect(openingDigestTab(evening, morning)).toBe('market');
    expect(openingDigestTab(morning, evening)).toBe('portfolio');
  });
  it('opens on the only one there is, and on Portfolio with neither', () => {
    expect(openingDigestTab(null, morning)).toBe('market');
    expect(openingDigestTab(evening, null)).toBe('portfolio');
    expect(openingDigestTab(null, null)).toBe('portfolio');
  });
});

describe('stripMarkdown', () => {
  it('leaves prose from a market digest: no heading marks, links, URLs or empty ()', () => {
    const md =
      '### Market overview\nStocks closed lower. ([apnews.com](https://apnews.com/a?utm_source=x)) My read: rates.\n\n' +
      '### Upcoming events\nCPI is Tuesday ([reuters.com](https://reuters.com/b), [bls.gov](https://bls.gov/c)). See https://example.com/z';
    const out = stripMarkdown(md);
    expect(out).toBe(
      'Market overview.\nStocks closed lower. My read: rates.\n\nUpcoming events.\nCPI is Tuesday. See',
    );
    expect(out).not.toMatch(/#|https?:|\(\s*\)|\]\(/);
  });
  it('keeps the text of an ordinary link and drops bold marks', () => {
    expect(stripMarkdown('The [Momentum](analyst:1) desk **sold** it.')).toBe('The Momentum desk sold it.');
  });
});
