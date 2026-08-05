import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../authMiddleware.js";
import { syncProduct, importDarazProduct, pullPriceStockFromDaraz } from "../daraz/sync.js";
import { getValidAccessToken } from "../daraz/tokens.js";
import { getCategoryAttributes, getProducts as searchDarazProducts } from "../daraz/client.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req, res) => {
  const products = await db.product.findMany({
    include: { variants: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ products });
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

  const product = await db.product.create({
    data: {
      title,
      descriptionHtml,
      vendor,
      imagesJson: JSON.stringify(images ?? []),
      variants: {
        create: variants.map((v) => ({
          sku: v.sku,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          quantity: v.quantity ?? 0,
        })),
      },
    },
    include: { variants: true },
  });

  res.status(201).json({ product });
});

router.get("/:id", async (req, res) => {
  const product = await db.product.findUnique({
    where: { id: req.params.id },
    include: { variants: true },
  });
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json({ product });
});

router.put("/:id", async (req, res) => {
  const { title, descriptionHtml, vendor, images, variants } = req.body as {
    title?: string;
    descriptionHtml?: string;
    vendor?: string;
    images?: string[];
    variants?: Array<{ id?: string; sku: string; price: string; quantity: number; compareAtPrice?: string }>;
  };

  const existing = await db.product.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  await db.product.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(descriptionHtml !== undefined ? { descriptionHtml } : {}),
      ...(vendor !== undefined ? { vendor } : {}),
      ...(images !== undefined ? { imagesJson: JSON.stringify(images) } : {}),
    },
  });

  if (variants) {
    // Replace the variant set wholesale - simplest correct behavior for a
    // small personal catalog rather than diffing add/update/remove.
    await db.productVariant.deleteMany({ where: { productId: req.params.id } });
    await db.productVariant.createMany({
      data: variants.map((v) => ({
        productId: req.params.id,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        quantity: v.quantity ?? 0,
      })),
    });
  }

  const product = await db.product.findUnique({
    where: { id: req.params.id },
    include: { variants: true },
  });
  res.json({ product });
});

router.delete("/:id", async (req, res) => {
  await db.product.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});

// Save (or update) the Daraz category + attribute mapping for a product.
router.put("/:id/mapping", async (req, res) => {
  const { categoryId, attributes } = req.body as {
    categoryId: string;
    attributes: Record<string, string>;
  };

  const product = await db.product.update({
    where: { id: req.params.id },
    data: {
      darazCategoryId: categoryId,
      attributesJson: JSON.stringify(attributes ?? {}),
      syncStatus: "pending",
      lastError: null,
    },
  });

  res.json({ product });
});

// Link an already-listed Daraz product to this local product instead of
// creating a duplicate.
router.post("/:id/link", async (req, res) => {
  const { darazItemId, darazCategoryId, darazSkuId } = req.body as {
    darazItemId: string;
    darazCategoryId?: string;
    darazSkuId?: string;
  };

  const product = await db.product.update({
    where: { id: req.params.id },
    data: {
      darazItemId,
      darazCategoryId: darazCategoryId ?? null,
      darazSkuId: darazSkuId ?? null,
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      lastError: null,
    },
  });

  res.json({ product });
});

router.post("/:id/sync", async (req, res) => {
  try {
    const existing = await db.product.findUnique({ where: { id: req.params.id } });
    await syncProduct(req.params.id, existing?.darazItemId ? "update" : "create");
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
    const names = (result.data?.attributes ?? []).map((a) => a.name).filter((n): n is string => Boolean(n));
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

router.post("/pull-from-daraz", async (_req, res) => {
  try {
    const result = await pullPriceStockFromDaraz();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
