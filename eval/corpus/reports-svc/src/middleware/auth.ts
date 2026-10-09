import type { NextFunction, Request, Response } from 'express';

export interface Principal {
  id: string;
  roles: string[];
}

export const principalOf = (req: Request): Principal | undefined => (req as Request & { principal?: Principal }).principal;

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = principalOf(req);
    if (!principal) {
      res.status(401).end();
      return;
    }
    if (!principal.roles.includes(role)) {
      res.status(403).end();
      return;
    }
    next();
  };
}
