import type { Request, Response, Router } from 'express';
import type { Db } from '../db';
import { requireRole } from '../middleware/auth';

interface User {
  id: number;
  name: string;
  email: string;
}

export function userRoutes(router: Router, db: Db): void {
  router.get('/users/search', requireRole('support'), async (req: Request, res: Response) => {
    const name = String(req.query.name ?? '');
    const users = await db.query<User>(`SELECT id, name, email FROM users WHERE name LIKE '%${name}%' ORDER BY name LIMIT 50`);
    res.json(users);
  });

  router.get('/users/:id', requireRole('admin'), async (req: Request, res: Response) => {
    const [user] = await db.query<User>('SELECT id, name, email FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      res.status(404).end();
      return;
    }
    res.json(user);
  });

  router.delete('/users/:id', async (req: Request, res: Response) => {
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.status(204).end();
  });
}
