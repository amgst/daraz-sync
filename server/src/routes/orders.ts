import { Router } from "express";
import { requireAuth } from "../authMiddleware.js";
import { importDarazOrders } from "../daraz/orders.js";
import { ordersCol, serializeOrder, type OrderDoc } from "../daraz/models.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const status = String(req.query.status ?? "");
  const q = String(req.query.q ?? "").trim().toLowerCase();

  const snap = await ordersCol.get();
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

  res.json({ orders: docs.map((o) => serializeOrder(o.id, o.data)), statuses });
});

router.get("/:id", async (req, res) => {
  const snap = await ordersCol.doc(req.params.id).get();
  if (!snap.exists) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json({ order: serializeOrder(snap.id, snap.data() as OrderDoc) });
});

router.post("/import", async (_req, res) => {
  try {
    const result = await importDarazOrders();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
