import type { Request, Response, Router } from 'express';
import type { Db } from '../db';
import { requireRole } from '../middleware/auth';

interface Order {
  id: number;
  customer_id: number;
  total_cents: number;
  lines?: OrderLine[];
}

interface OrderLine {
  order_id: number;
  sku: string;
  qty: number;
}

const PAGE_SIZE = 20;

export function orderRoutes(router: Router, db: Db): void {
  // Pages are numbered from 1, as the frontend shows them.
  router.get('/orders', requireRole('staff'), async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const offset = page * PAGE_SIZE;
    const orders = await db.query<Order>('SELECT id, customer_id, total_cents FROM orders ORDER BY id LIMIT ? OFFSET ?', [PAGE_SIZE, offset]);
    for (const order of orders) {
      order.lines = await db.query<OrderLine>('SELECT order_id, sku, qty FROM order_lines WHERE order_id = ?', [order.id]);
    }
    res.json({ page, orders });
  });
}
