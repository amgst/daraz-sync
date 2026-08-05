import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../authMiddleware.js";
import { importDarazOrders } from "../daraz/orders.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const status = String(req.query.status ?? "");
  const q = String(req.query.q ?? "");

  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q } },
            { darazOrderId: { contains: q } },
            { customerName: { contains: q } },
          ],
        }
      : {}),
  };

  const orders = await db.darazOrder.findMany({
    where,
    include: { items: true },
    orderBy: [{ darazCreatedAt: "desc" }, { importedAt: "desc" }],
  });

  const distinctStatuses = await db.darazOrder.findMany({
    distinct: ["status"],
    select: { status: true },
  });

  res.json({ orders, statuses: distinctStatuses.map((s) => s.status).sort() });
});

router.get("/:id", async (req, res) => {
  const order = await db.darazOrder.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json({ order });
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
