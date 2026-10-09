import type { Request, Response, Router } from 'express';
import type { Db } from '../db';
import { remember } from '../lib/cache';

interface Product {
  sku: string;
  name: string;
  price_cents: number;
}

// Public catalogue: no login required.
export function productRoutes(router: Router, db: Db): void {
  router.get('/products/:sku', async (req: Request, res: Response) => {
    const sku = req.params.sku;
    const rows = await remember(`product:${sku}`, 60_000, () => db.query<Product>('SELECT sku, name, price_cents FROM products WHERE sku = ?', [sku]));
    if (!rows.length) {
      res.status(404).end();
      return;
    }
    res.json(rows[0]);
  });
}
