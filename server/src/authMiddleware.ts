import type { Request, Response, NextFunction } from "express";

export interface SessionData {
  loggedIn?: boolean;
  currentStoreId?: string;
}

// cookie-session attaches `session` to the request at runtime; this augments
// the type so route handlers get it typed without a `req.session as any`.
// Assigning `null` (as the logout route does) destroys the session cookie.
declare global {
  namespace Express {
    interface Request {
      session?: (SessionData & { [key: string]: unknown }) | null;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.loggedIn) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}

// For routes that operate on "the current store" (products, orders, sync) -
// must run after requireAuth. Kept separate since a few auth-gated routes
// (e.g. listing/adding stores) don't need a store selected yet.
export function requireStore(req: Request, res: Response, next: NextFunction) {
  if (req.session?.currentStoreId) {
    next();
    return;
  }
  res.status(400).json({ error: "No store selected" });
}
