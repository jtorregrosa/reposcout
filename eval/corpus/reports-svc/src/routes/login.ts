import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import type { Db } from '../db';

interface Credential {
  user_id: string;
  salt: string;
  hash: string;
}

const ITERATIONS = 600_000;
// Hashed when the e-mail is unknown, so both answers take as long and the time does not reveal which accounts exist.
const DUMMY: Credential = { user_id: '', salt: '00'.repeat(16), hash: '00'.repeat(32) };

// Attempts are rate-limited per IP and per e-mail by the gateway in front of the service.
export function loginRoutes(router: Router, db: Db): void {
  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).end();
      return;
    }
    const [found] = await db.query<Credential>('SELECT user_id, salt, hash FROM credentials WHERE email = ?', [email]);
    const cred = found ?? DUMMY;
    const candidate = pbkdf2Sync(password, Buffer.from(cred.salt, 'hex'), ITERATIONS, 32, 'sha256');
    const stored = Buffer.from(cred.hash, 'hex');
    if (!found || stored.length !== candidate.length || !timingSafeEqual(stored, candidate)) {
      res.status(401).end();
      return;
    }
    res.json({ user_id: cred.user_id });
  });
}
