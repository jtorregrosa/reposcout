import type { Request, Response, Router } from 'express';
import type { Db } from '../db';
import { principalOf } from '../middleware/auth';

interface AuditEvent {
  id: number;
  user_id: string;
  action: string;
  at: string;
}

// Every request a signed-in user makes is recorded in audit_events; rows are never deleted, for compliance.
export function recordEvent(db: Db, userId: string, action: string): Promise<unknown> {
  return db.query('INSERT INTO audit_events (user_id, action, at) VALUES (?, ?, ?)', [userId, action, new Date().toISOString()]);
}

// "My activity" page in the account menu.
export function activityRoutes(router: Router, db: Db): void {
  router.get('/me/activity', async (req: Request, res: Response) => {
    const principal = principalOf(req);
    if (!principal) {
      res.status(401).end();
      return;
    }
    const events = await db.query<AuditEvent>('SELECT id, user_id, action, at FROM audit_events WHERE user_id = ? ORDER BY at DESC', [principal.id]);
    res.json({ events });
  });
}
