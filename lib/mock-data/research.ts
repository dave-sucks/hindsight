// Mock data for research runs — matches future Prisma schema shape

export type ResearchDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface ThesisBullet {
  point: string;
}

export interface RiskFlag {
  flag: string;
}

export interface MockThesis {
  id: string;
  ticker: string;
  companyName: string;
  direction: ResearchDirection;
  confidenceScore: number; // 0–100
  summary: string;
  bullets: ThesisBullet[];
  riskFlags: RiskFlag[];
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  riskReward: number;
  holdDuration: string;
  researchedAt: string;
  triggeredBy: 'USER' | 'AGENT';
}

export const mockResearchRuns: MockThesis[] = [
  {
    id: 'thesis-1',
    ticker: 'NVDA',
    companyName: 'NVIDIA Corporation',
    direction: 'LONG',
    confidenceScore: 82,
    summary: 'Data center AI chip demand accelerating faster than supply — margin expansion thesis intact.',
    bullets: [
      { point: 'H100/H200 backlog extends into Q3 2026; hyperscalers increasing capex 40%+ YoY' },
      { point: 'Gross margin guided above 76% — software/networking mix improving' },
      { point: 'Blackwell ramp on track; competitor lead 18+ months behind on process node' },
      { point: 'China headwinds partially offset by India and Southeast Asia datacenter buildout' },
    ],
    riskFlags: [
      { flag: 'China export restrictions' },
      { flag: 'Customer concentration (3 hyperscalers >60% rev)' },
      { flag: 'Valuation premium vs. SOX peers' },
    ],
    entryPrice: 875.00,
    targetPrice: 950.00,
    stopPrice: 840.00,
    riskReward: 2.14,
    holdDuration: 'Swing (2–6 weeks)',
    researchedAt: '2026-03-01T09:15:00Z',
    triggeredBy: 'USER',
  },
  {
    id: 'thesis-2',
    ticker: 'TSLA',
    companyName: 'Tesla, Inc.',
    direction: 'SHORT',
    confidenceScore: 71,
    summary: 'Q1 delivery miss likely; margin pressure from price cuts outweighs FSD optionality near-term.',
    bullets: [
      { point: 'Q1 2026 delivery consensus at 490k — internal signals suggest 460–470k range' },
      { point: 'Auto gross margin ex-credits ~14%, declining 200bps QoQ on ongoing price war' },
      { point: 'Cybertruck warranty costs impacting services segment' },
      { point: 'FSD v13 revenue recognition delayed — software attach rate below guidance' },
    ],
    riskFlags: [
      { flag: 'Elon news catalyst risk' },
      { flag: 'Short squeeze potential (high SI)' },
      { flag: 'Energy/storage beat could offset auto miss' },
    ],
    entryPrice: 245.00,
    targetPrice: 215.00,
    stopPrice: 260.00,
    riskReward: 2.00,
    holdDuration: 'Swing (2–4 weeks)',
    researchedAt: '2026-03-03T14:30:00Z',
    triggeredBy: 'USER',
  },
  {
    id: 'thesis-3',
    ticker: 'META',
    companyName: 'Meta Platforms, Inc.',
    direction: 'LONG',
    confidenceScore: 79,
    summary: 'Reels monetization inflecting; AI-driven ad efficiency creating durable margin expansion.',
    bullets: [
      { point: 'Reels CPM up 35% YoY — closing gap vs. linear video ad spend' },
      { point: 'Llama 4 cutting ad ranking latency 60%; click-through rates +12%' },
      { point: 'WhatsApp Business API monetization in early innings — $10B TAM by 2027' },
      { point: 'Reality Labs losses plateauing; Quest 3 attach rate improving' },
    ],
    riskFlags: [
      { flag: 'Regulatory risk (EU DSA compliance costs)' },
      { flag: 'Apple ATT headwinds persistent' },
    ],
    entryPrice: 610.00,
    targetPrice: 680.00,
    stopPrice: 580.00,
    riskReward: 2.33,
    holdDuration: 'Position (6–12 weeks)',
    researchedAt: '2026-03-06T11:00:00Z',
    triggeredBy: 'AGENT',
  },
];

// Mock response for a new user research request
export function getMockThesisForTicker(ticker: string): MockThesis {
  const existing = mockResearchRuns.find(
    (r) => r.ticker.toUpperCase() === ticker.toUpperCase()
  );
  if (existing) return existing;

  // Generic fallback thesis
  return {
    id: `thesis-${Date.now()}`,
    ticker: ticker.toUpperCase(),
    companyName: `${ticker.toUpperCase()} Corp`,
    direction: 'LONG',
    confidenceScore: 65,
    summary: `Technical and fundamental analysis suggests a moderate bullish setup for ${ticker.toUpperCase()}.`,
    bullets: [
      { point: 'Momentum indicators in oversold territory — mean reversion opportunity' },
      { point: 'Sector rotation favoring growth names; macro tailwind from Fed pause' },
      { point: 'Recent pullback to key support zone with elevated volume on dip' },
    ],
    riskFlags: [
      { flag: 'Earnings in 3 weeks — binary event risk' },
      { flag: 'Broader market correction risk' },
    ],
    entryPrice: 100.00,
    targetPrice: 112.00,
    stopPrice: 93.00,
    riskReward: 1.71,
    holdDuration: 'Swing (2–4 weeks)',
    researchedAt: new Date().toISOString(),
    triggeredBy: 'USER',
  };
}
