import { Router } from "express";
import { requireAuth } from "../authMiddleware.js";
import { storesCol, productsCol, ordersCol, type StoreDoc } from "../daraz/models.js";
import { isDarazCountry, DARAZ_SITES } from "../daraz/countries.js";

const router = Router();
router.use(requireAuth);

function serializeStore(id: string, data: StoreDoc, currentStoreId: string | undefined) {
  return {
    id,
    name: data.name,
    country: data.country,
    countryLabel: isDarazCountry(data.country) ? DARAZ_SITES[data.country].label : data.country,
    sellerId: data.sellerId,
    connectedAt: data.connectedAt.toDate().toISOString(),
    isCurrent: id === currentStoreId,
  };
}

router.get("/", async (req, res) => {
  const snap = await storesCol.orderBy("createdAt", "asc").get();
  const stores = await Promise.all(
    snap.docs.map(async (doc) => {
      const [productCount, orderCount] = await Promise.all([
        productsCol.where("storeId", "==", doc.id).count().get(),
        ordersCol.where("storeId", "==", doc.id).count().get(),
      ]);
      return {
        ...serializeStore(doc.id, doc.data() as StoreDoc, req.session?.currentStoreId),
        productCount: productCount.data().count,
        orderCount: orderCount.data().count,
      };
    }),
  );
  res.json({ stores, currentStoreId: req.session?.currentStoreId ?? null });
});

router.post("/:id/select", async (req, res) => {
  const snap = await storesCol.doc(req.params.id).get();
  if (!snap.exists) {
    res.status(404).json({ error: "Store not found" });
    return;
  }
  if (req.session) req.session.currentStoreId = req.params.id;
  res.json({ ok: true });
});

router.put("/:id", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const ref = storesCol.doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Store not found" });
    return;
  }
  await ref.update({ name: name.trim() });
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  await storesCol.doc(req.params.id).delete();
  if (req.session?.currentStoreId === req.params.id) {
    delete req.session.currentStoreId;
  }
  res.json({ ok: true });
});

export default router;
