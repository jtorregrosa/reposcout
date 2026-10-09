import type { Request, Response, Router } from 'express';
import { requireRole } from '../middleware/auth';

// The three regions the service replicates to. Adding one is a deployment change.
const REGIONS = ['eu-west', 'us-east', 'ap-south'] as const;

// Operations' status page: polled by hand when something looks wrong, not by monitoring.
export function healthRoutes(router: Router): void {
  router.get('/admin/regions', requireRole('ops'), async (_req: Request, res: Response) => {
    const status: Record<string, boolean> = {};
    for (const region of REGIONS) {
      try {
        const r = await fetch(`https://${region}.internal.example/health`, { signal: AbortSignal.timeout(2_000) });
        status[region] = r.ok;
      } catch {
        status[region] = false;
      }
    }
    res.json(status);
  });
}
