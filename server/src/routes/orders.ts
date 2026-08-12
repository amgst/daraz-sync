import { Router } from "express";
import { requireAuth, requireStore } from "../authMiddleware.js";
import { importDarazOrders } from "../daraz/orders.js";
import { ordersCol, serializeOrder, type OrderDoc } from "../daraz/models.js";

const router = Router();
router.use(requireAuth);
router.use(requireStore);

// Pagination is opt-in via ?pageSize= - callers that just want the full
// list (e.g. the dashboard's counts) keep working unchanged. Sorting/filtering
// happens in memory (fallback-chain sort, free-text search) so the page is
// sliced out of that same in-memory list rather than pushed to Firestore.
router.get("/", async (req, res) => {
  const storeId = req.session!.currentStoreId!;
  const status = String(req.query.status ?? "");
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const pageSizeParam = Number(req.query.pageSize);
  const pageSize = req.query.pageSize && pageSizeParam > 0 ? Math.min(100, pageSizeParam) : null;
  const page = Math.max(1, Number(req.query.page) || 1);

  try {
    const snap = await ordersCol.where("storeId", "==", storeId).get();
    let docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as OrderDoc }));

    if (status) {
      docs = docs.filter((o) => o.data.status === status);
    }
    if (q) {
      docs = docs.filter(
        (o) =>
          (o.data.orderNumber ?? "").toLowerCase().includes(q) ||
          o.data.darazOrderId.toLowerCase().includes(q) ||
          (o.data.customerName ?? "").toLowerCase().includes(q),
      );
    }

    docs.sort((a, b) => {
      const aCreated = a.data.darazCreatedAt?.toMillis();
      const bCreated = b.data.darazCreatedAt?.toMillis();
      if (aCreated !== bCreated) {
        if (aCreated === undefined) return 1;
        if (bCreated === undefined) return -1;
        return bCreated - aCreated;
      }
      return b.data.importedAt.toMillis() - a.data.importedAt.toMillis();
    });

    const statuses = Array.from(new Set(snap.docs.map((d) => (d.data() as OrderDoc).status))).sort();
    const total = docs.length;
    const pageDocs = pageSize ? docs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : docs;
    const orders = pageDocs.map((o) => serializeOrder(o.id, o.data));

    res.json(
      pageSize
        ? { orders, statuses, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
        : { orders, statuses },
    );
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/:id", async (req, res) => {
  const snap = await ordersCol.doc(req.params.id).get();
  if (!snap.exists || (snap.data() as OrderDoc).storeId !== req.session!.currentStoreId!) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json({ order: serializeOrder(snap.id, snap.data() as OrderDoc) });
});

router.post("/import", async (req, res) => {
  try {
    const result = await importDarazOrders(req.session!.currentStoreId!);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
