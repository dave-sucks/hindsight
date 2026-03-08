import { readFileSync } from 'fs';

// Load .env.local manually
const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
}

const AlpacaModule = await import('@alpacahq/alpaca-trade-api');
const Alpaca = AlpacaModule.default?.default || AlpacaModule.default || AlpacaModule;

const client = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
  baseUrl: process.env.ALPACA_BASE_URL,
  paper: true,
});

console.log('\n=== Q1: Account (short selling + balance) ===');
const account = await client.getAccount();
console.log('Cash:', account.cash);
console.log('Buying power:', account.buying_power);
console.log('Shorting enabled:', account.shorting_enabled);
console.log('Status:', account.status);

console.log('\n=== Q2: Latest equity price (NVDA) ===');
const trade = await client.getLatestTrade('NVDA');
console.log('Trade keys:', Object.keys(trade));
console.log('Price (p):', trade.p);

console.log('\n=== Q3: Crypto support (BTC/USD) ===');
try {
  const cryptoTrades = await client.getLatestCryptoTrades(['BTC/USD'], {});
  const btc = cryptoTrades.get('BTC/USD');
  console.log('BTC/USD price:', btc ? btc.p : 'N/A');
  console.log('Crypto supported:', !!btc);
} catch (e) {
  console.log('Crypto error:', e.message);
}

console.log('\n=== Q4: Market clock ===');
const clock = await client.getClock();
console.log('Market open:', clock.is_open);
console.log('Next open:', clock.next_open);
console.log('Next close:', clock.next_close);

console.log('\n=== Q5: Place + immediately cancel a paper order (AAPL 1 share) ===');
try {
  const order = await client.createOrder({
    symbol: 'AAPL', qty: 1, side: 'buy', type: 'market', time_in_force: 'day'
  });
  console.log('Order placed:', order.id, 'status:', order.status);
  // Cancel right away
  await client.cancelOrder(order.id);
  console.log('Order cancelled. Fill was instant:', order.status === 'filled');
} catch (e) {
  console.log('Order error:', e.message);
}
