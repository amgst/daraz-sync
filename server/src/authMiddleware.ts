import type { Request, Response, NextFunction } from "express";

export interface SessionData {
  role?: "admin" | "customer";
  userId?: string; // only set when role === "customer"
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
  if (req.session?.role) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.role === "admin") {
    next();
    return;
  }
  res.status(403).json({ error: "Admin access required" });
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

// True for an admin (can manage any store) or a customer who owns this
// specific store. Shared by routes/stores.ts and routes/daraz.ts so a
// customer can't rename/disconnect/reconnect another customer's store.
export function canManageStore(req: Request, ownerUserId: string | null): boolean {
  if (req.session?.role === "admin") return true;
  return req.session?.role === "customer" && ownerUserId === req.session.userId;
}
