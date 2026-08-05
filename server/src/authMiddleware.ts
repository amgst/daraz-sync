import type { Request, Response, NextFunction } from "express";

export interface SessionData {
  loggedIn?: boolean;
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
