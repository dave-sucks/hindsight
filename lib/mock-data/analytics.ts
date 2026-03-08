// Mock analytics data — matches future computed fields from trade history

// 30-day equity curve
export const mockEquityCurve = Array.from({ length: 30 }, (_, i) => {
  const date = new Date('2026-02-07');
  date.setDate(date.getDate() + i);
  const base = 100_000;
  const trend = i * 145;
  const noise = Math.sin(i * 0.5) * 600 + Math.cos(i * 0.3) * 300;
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: Math.round(base + trend + noise),
  };
});

// Win/Loss by direction
export const mockDirectionBreakdown = [
  { direction: 'Long', wins: 8, losses: 3 },
  { direction: 'Short', wins: 4, losses: 5 },
];

// Return by hold duration
export const mockDurationBreakdown = [
  { duration: 'Day Trade', avgReturn: 1.2, trades: 3 },
  { duration: 'Swing', avgReturn: 4.8, trades: 12 },
  { duration: 'Position', avgReturn: 7.1, trades: 3 },
];

// Return by sector
export const mockSectorBreakdown = [
  { sector: 'Technology', return: 6.4 },
  { sector: 'Finance', return: 2.1 },
  { sector: 'Consumer', return: -3.2 },
  { sector: 'Energy', return: 1.8 },
  { sector: 'Healthcare', return: 4.0 },
];

// Confidence score vs outcome scatter
export const mockConfidenceScatter = [
  { confidence: 82, return: 5.26, ticker: 'NVDA' },
  { confidence: 71, return: 5.71, ticker: 'TSLA' },
  { confidence: 68, return: 1.54, ticker: 'AAPL' },
  { confidence: 79, return: 10.20, ticker: 'META' },
  { confidence: 61, return: -10.36, ticker: 'COIN' },
  { confidence: 85, return: 6.67, ticker: 'MSFT' },
  { confidence: 66, return: -7.43, ticker: 'AMD' },
  { confidence: 77, return: 10.10, ticker: 'AMZN' },
  { confidence: 58, return: -13.60, ticker: 'SNAP' },
  { confidence: 64, return: 0.56, ticker: 'NFLX' },
  { confidence: 75, return: 3.80, ticker: 'GOOGL' },
  { confidence: 80, return: 8.20, ticker: 'ORCL' },
  { confidence: 55, return: -4.50, ticker: 'LYFT' },
  { confidence: 70, return: 2.10, ticker: 'PYPL' },
  { confidence: 88, return: 12.40, ticker: 'AVGO' },
  { confidence: 60, return: -2.80, ticker: 'ROKU' },
  { confidence: 73, return: 4.60, ticker: 'CRM' },
  { confidence: 67, return: 1.90, ticker: 'ADBE' },
];

// Summary stats
export const mockStats = {
  totalReturn: 4_350,
  totalReturnPct: 4.35,
  winRate: 62,
  avgReturnPerTrade: 4.2,
  openTrades: 3,
  closedTrades: 15,
  totalTrades: 18,
  // Graduation thresholds
  graduation: {
    winRateTarget: 65,
    closedTradesRequired: 20,
    currentWinRate: 62,
    currentClosedTrades: 15,
  },
};
