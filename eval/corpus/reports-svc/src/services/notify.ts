import type { Db } from '../db';

interface Subscriber {
  id: string;
  webhook_url: string;
}

// Called from POST /products/:sku/price after the new price is saved, before the response is sent. Any merchant
// can subscribe a webhook to price changes, and the busiest products have thousands of subscribers. A webhook URL is
// accepted at subscription time only for the merchant's verified domain, over https.
export async function notifyPriceChange(db: Db, sku: string, priceCents: number): Promise<number> {
  const subscribers = await db.query<Subscriber>('SELECT id, webhook_url FROM price_subscribers WHERE sku = ?', [sku]);
  let delivered = 0;
  for (const s of subscribers) {
    try {
      const res = await fetch(s.webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, price_cents: priceCents }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) delivered++;
    } catch {
      // A subscriber that is down misses this change; the next one reaches it.
    }
  }
  return delivered;
}
