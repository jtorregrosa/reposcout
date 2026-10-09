import type { Request, Response, Router } from 'express';
import type { Db } from '../db';
import { requireRole } from '../middleware/auth';

// Finance dashboard header: the total still owed across every unpaid invoice.
export function statsRoutes(router: Router, db: Db): void {
  router.get('/stats/outstanding', requireRole('accounts'), async (_req: Request, res: Response) => {
    const [row] = await db.query<{ total: number | null }>('SELECT SUM(amount_cents) AS total FROM invoices WHERE paid = 0');
    res.json({ outstanding_cents: row?.total ?? 0 });
  });
}
