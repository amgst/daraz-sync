import { Router } from "express";
import { importDarazOrders } from "../daraz/orders.js";
import { pullPriceStockFromDaraz } from "../daraz/sync.js";
import { storesCol } from "../daraz/models.js";

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

  const storesSnap = await storesCol.get();

  const results: Record<
    string,
    {
      orders?: { imported: number; updated: number };
      ordersError?: string;
      products?: { productsChecked: number; productsUpdated: number; errors: string[] };
      productsError?: string;
    }
  > = {};

  // Each store, and each half within a store, runs independently - one
  // store (or one half) failing shouldn't block the rest.
  for (const storeDoc of storesSnap.docs) {
    const storeResult: (typeof results)[string] = {};

    try {
      storeResult.orders = await importDarazOrders(storeDoc.id);
    } catch (error) {
      storeResult.ordersError = error instanceof Error ? error.message : String(error);
    }

    try {
      storeResult.products = await pullPriceStockFromDaraz(storeDoc.id);
    } catch (error) {
      storeResult.productsError = error instanceof Error ? error.message : String(error);
    }

    results[storeDoc.id] = storeResult;
  }

  res.json({ stores: results });
});

export default router;
