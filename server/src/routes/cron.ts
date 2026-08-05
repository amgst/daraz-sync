import { Router } from "express";
import { importDarazOrders } from "../daraz/orders.js";
import { pullPriceStockFromDaraz } from "../daraz/sync.js";

const router = Router();

// Vercel Cron calls this on a schedule with `Authorization: Bearer
// ${CRON_SECRET}` - not behind the app's own login (cookie-session), since
// there's no browser session here. Reject anything that doesn't present the
// secret so the URL can't be used to trigger syncs by anyone who finds it.
router.get("/sync", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result: {
    orders?: { imported: number; updated: number };
    ordersError?: string;
    products?: { productsChecked: number; productsUpdated: number; errors: string[] };
    productsError?: string;
  } = {};

  // Each half runs independently - one failing (e.g. no Daraz account
  // connected yet) shouldn't block the other from still running.
  try {
    result.orders = await importDarazOrders();
  } catch (error) {
    result.ordersError = error instanceof Error ? error.message : String(error);
  }

  try {
    result.products = await pullPriceStockFromDaraz();
  } catch (error) {
    result.productsError = error instanceof Error ? error.message : String(error);
  }

  res.json(result);
});

export default router;
