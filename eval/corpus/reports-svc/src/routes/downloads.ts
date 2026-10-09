import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Response, Router } from 'express';
import type { Db } from '../db';
import { requireRole } from '../middleware/auth';

interface ExportRow {
  id: string;
  file_name: string;
}

const EXPORT_DIR = '/var/lib/reports-svc/exports';

// Finance downloads the monthly order exports from here; a busy month's file runs to several hundred megabytes.
export function downloadRoutes(router: Router, db: Db): void {
  router.get('/exports/:id', requireRole('finance'), async (req: Request, res: Response) => {
    const [row] = await db.query<ExportRow>('SELECT id, file_name FROM exports WHERE id = ?', [req.params.id]);
    if (!row) {
      res.status(404).end();
      return;
    }
    const content = await readFile(join(EXPORT_DIR, row.file_name));
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', `attachment; filename="${row.id}.csv"`);
    res.send(content);
  });
}
