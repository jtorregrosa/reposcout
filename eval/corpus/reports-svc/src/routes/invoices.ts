import type { Request, Response, Router } from 'express';
import type { Db } from '../db';
import { requireRole } from '../middleware/auth';

interface InvoiceRow {
  id: string;
  customer_id: string;
  amount_cents: number;
  issued_at: string;
}

interface Customer {
  id: string;
  name: string;
  email: string;
}

const PAGE_SIZE = 50;

// The accounts team's main screen: every invoice with the name of the customer it was issued to.
export function invoiceRoutes(router: Router, db: Db): void {
  router.get('/invoices', requireRole('accounts'), async (req: Request, res: Response) => {
    const page = Math.max(0, Number(req.query.page ?? 0) || 0);
    const rows = await db.query<InvoiceRow>('SELECT id, customer_id, amount_cents, issued_at FROM invoices ORDER BY issued_at DESC LIMIT ? OFFSET ?', [
      PAGE_SIZE,
      page * PAGE_SIZE,
    ]);
    const invoices = [];
    for (const row of rows) {
      const [customer] = await db.query<Customer>('SELECT id, name, email FROM customers WHERE id = ?', [row.customer_id]);
      invoices.push({ ...row, customer: customer ? { id: customer.id, name: customer.name } : null });
    }
    res.json({ page, invoices });
  });
}
