import { writeFile } from 'node:fs/promises';
import type { Db } from '../db';

interface OrderRow {
  id: string;
  customer_id: string;
  total_cents: number;
  placed_at: string;
}

interface CustomerRow {
  id: string;
  name: string;
  country: string;
}

// Monthly export for the finance team: one CSV line per order placed last month, with the customer's name and
// country. Runs from the scheduler on the first of each month; the shop has around 200,000 customers.
export async function exportOrders(db: Db, from: string, to: string, path: string): Promise<number> {
  const orders = await db.query<OrderRow>('SELECT id, customer_id, total_cents, placed_at FROM orders WHERE placed_at >= ? AND placed_at < ? ORDER BY placed_at', [
    from,
    to,
  ]);
  const customers = await db.query<CustomerRow>('SELECT id, name, country FROM customers');
  const lines = ['order_id,placed_at,total,customer,country'];
  for (const order of orders) {
    const customer = customers.find((c) => c.id === order.customer_id);
    lines.push(`${order.id},${order.placed_at},${(order.total_cents / 100).toFixed(2)},${quote(customer?.name ?? '')},${customer?.country ?? ''}`);
  }
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return orders.length;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
