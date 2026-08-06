import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { requireAuth } from "../authMiddleware.js";
import { syncProduct, importDarazProduct, importAllDarazProducts, pullPriceStockFromDaraz } from "../daraz/sync.js";
import { getValidAccessToken } from "../daraz/tokens.js";
import { getCategoryAttributes, getProducts as searchDarazProducts, RESERVED_ATTRIBUTE_KEYS } from "../daraz/client.js";
import { productsCol, serializeProduct, type ProductDoc, type VariantDoc } from "../daraz/models.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req, res) => {
  const snap = await productsCol.orderBy("updatedAt", "desc").get();
  res.json({ products: snap.docs.map((d) => serializeProduct(d.id, d.data() as ProductDoc)) });
});

router.post("/", async (req, res) => {
  const { title, descriptionHtml, vendor, images, variants } = req.body as {
    title: string;
    descriptionHtml?: string;
    vendor?: string;
    images?: string[];
    variants: Array<{ sku: string; price: string; quantity: number; compareAtPrice?: string }>;
  };

  if (!title || !variants?.length) {
    res.status(400).json({ error: "Title and at least one variant (SKU + price) are required" });
    return;
  }

  const now = Timestamp.now();
  const docRef = productsCol.doc();
  const data: ProductDoc = {
    title,
    descriptionHtml: descriptionHtml ?? null,
    vendor: vendor ?? null,
    imagesJson: JSON.stringify(images ?? []),
    darazCategoryId: null,
    attributesJson: null,
    darazItemId: null,
    darazSkuId: null,
    syncStatus: "unmapped",
    lastSyncedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    variants: variants.map((v) => ({
      id: randomUUID(),
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compareAtPrice ?? null,
      quantity: v.quantity ?? 0,
      packageWeightKg: null,
    })),
  };

  await docRef.set(data);

  res.status(201).json({ product: serializeProduct(docRef.id, data) });
});

router.get("/:id", async (req, res) => {
  const snap = await productsCol.doc(req.params.id).get();
  if (!snap.exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json({ product: serializeProduct(snap.id, snap.data() as ProductDoc) });
});

router.put("/:id", async (req, res) => {
  const { title, descriptionHtml, vendor, images, variants } = req.body as {
    title?: string;
    descriptionHtml?: string;
    vendor?: string;
    images?: string[];
    variants?: Array<{ id?: string; sku: string; price: string; quantity: number; compareAtPrice?: string }>;
  };

  const docRef = productsCol.doc(req.params.id);
  const existing = await docRef.get();
  if (!existing.exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const update: Record<string, unknown> = { updatedAt: Timestamp.now() };
  if (title !== undefined) update.title = title;
  if (descriptionHtml !== undefined) update.descriptionHtml = descriptionHtml;
  if (vendor !== undefined) update.vendor = vendor;
  if (images !== undefined) update.imagesJson = JSON.stringify(images);

  if (variants) {
    // Replace the variant set wholesale - simplest correct behavior for a
    // small personal catalog rather than diffing add/update/remove.
    update.variants = variants.map(
      (v): VariantDoc => ({
        id: randomUUID(),
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        quantity: v.quantity ?? 0,
        packageWeightKg: null,
      }),
    );
  }

  await docRef.update(update);

  const updated = await docRef.get();
  res.json({ product: serializeProduct(updated.id, updated.data() as ProductDoc) });
});

router.delete("/:id", async (req, res) => {
  await productsCol.doc(req.params.id).delete();
  res.json({ ok: true });
});

// Save (or update) the Daraz category + attribute mapping for a product.
router.put("/:id/mapping", async (req, res) => {
  const { categoryId, attributes } = req.body as {
    categoryId: string;
    attributes: Record<string, string>;
  };

  const docRef = productsCol.doc(req.params.id);
  await docRef.update({
    darazCategoryId: categoryId,
    attributesJson: JSON.stringify(attributes ?? {}),
    syncStatus: "pending",
    lastError: null,
    updatedAt: Timestamp.now(),
  });

  const updated = await docRef.get();
  res.json({ product: serializeProduct(updated.id, updated.data() as ProductDoc) });
});

// Link an already-listed Daraz product to this local product instead of
// creating a duplicate.
router.post("/:id/link", async (req, res) => {
  const { darazItemId, darazCategoryId, darazSkuId } = req.body as {
    darazItemId: string;
    darazCategoryId?: string;
    darazSkuId?: string;
  };

  const docRef = productsCol.doc(req.params.id);
  await docRef.update({
    darazItemId,
    darazCategoryId: darazCategoryId ?? null,
    darazSkuId: darazSkuId ?? null,
    syncStatus: "synced",
    lastSyncedAt: Timestamp.now(),
    lastError: null,
    updatedAt: Timestamp.now(),
  });

  const updated = await docRef.get();
  res.json({ product: serializeProduct(updated.id, updated.data() as ProductDoc) });
});

router.post("/:id/sync", async (req, res) => {
  try {
    const existing = await productsCol.doc(req.params.id).get();
    const product = existing.data() as ProductDoc | undefined;
    await syncProduct(req.params.id, product?.darazItemId ? "update" : "create");
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/:id/suggested-attributes", async (req, res) => {
  const categoryId = String(req.query.categoryId ?? "");
  if (!categoryId) {
    res.json({ suggestions: [] });
    return;
  }
  try {
    const session = await getValidAccessToken();
    if (!session) {
      res.json({ suggestions: [] });
      return;
    }
    const result = (await getCategoryAttributes(
      { accessToken: session.accessToken, country: session.country },
      categoryId,
    )) as { data?: { attributes?: Array<{ name?: string }> } };
    // Daraz's category attribute schema lists basic fields (name/description/
    // brand) alongside real custom attributes, but this app already sends
    // those via their own Title/Description/Brand inputs - suggesting them
    // here just invites a duplicate, blank override (see buildProductPayload).
    const names = (result.data?.attributes ?? [])
      .map((a) => a.name)
      .filter((n): n is string => Boolean(n))
      .filter((n) => !RESERVED_ATTRIBUTE_KEYS.has(n));
    res.json({ suggestions: names });
  } catch {
    res.json({ suggestions: [] });
  }
});

router.get("/search/daraz", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  if (!query) {
    res.json({ results: [] });
    return;
  }
  try {
    const session = await getValidAccessToken();
    if (!session) {
      res.status(400).json({ error: "Not connected to Daraz" });
      return;
    }
    const results = await searchDarazProducts(
      { accessToken: session.accessToken, country: session.country },
      { search: query },
    );
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/import", async (req, res) => {
  const { darazItemId } = req.body as { darazItemId: string };
  try {
    const result = await importDarazProduct(darazItemId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/import-all", async (_req, res) => {
  try {
    const result = await importAllDarazProducts();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/pull-from-daraz", async (_req, res) => {
  try {
    const result = await pullPriceStockFromDaraz();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
