export interface MarketIndex {
  ticker: string;
  label: string;
  price: number;
  change: number;
  changePct: number;
  sparkline: number[]; // last 20 data points (relative values)
}

export const mockMarketIndices: MarketIndex[] = [
  {
    ticker: 'SPX',
    label: 'S&P 500',
    price: 5_187.70,
    change: -41.2,
    changePct: -0.79,
    sparkline: [5230, 5218, 5212, 5224, 5210, 5198, 5205, 5195, 5200, 5192, 5188, 5195, 5202, 5194, 5188, 5180, 5185, 5190, 5184, 5188],
  },
  {
    ticker: 'COMP',
    label: 'NASDAQ',
    price: 16_290.45,
    change: -247.6,
    changePct: -1.50,
    sparkline: [16540, 16510, 16480, 16520, 16495, 16460, 16440, 16420, 16430, 16410, 16400, 16380, 16395, 16370, 16350, 16340, 16310, 16300, 16295, 16290],
  },
  {
    ticker: 'BTC',
    label: 'Bitcoin',
    price: 68_420.00,
    change: 1_620.0,
    changePct: 2.43,
    sparkline: [66800, 67000, 67200, 66900, 67100, 67400, 67600, 67500, 67800, 67900, 68000, 68100, 68050, 68200, 68150, 68300, 68250, 68350, 68400, 68420],
  },
  {
    ticker: 'ETH',
    label: 'Ethereum',
    price: 3_512.80,
    change: 38.4,
    changePct: 1.11,
    sparkline: [3474, 3480, 3470, 3478, 3482, 3488, 3492, 3490, 3495, 3500, 3498, 3504, 3508, 3506, 3510, 3512, 3509, 3511, 3513, 3513],
  },
  {
    ticker: 'VIX',
    label: 'VIX',
    price: 24.17,
    change: 1.82,
    changePct: 8.15,
    sparkline: [22.4, 22.1, 22.8, 23.0, 22.6, 22.9, 23.2, 23.1, 23.5, 23.8, 23.6, 23.9, 24.1, 24.0, 24.2, 23.9, 24.1, 24.3, 24.2, 24.2],
  },
];
