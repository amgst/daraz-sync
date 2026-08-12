import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { requireAuth, requireStore } from "../authMiddleware.js";
import { syncProduct, importDarazProduct, importAllDarazProducts, pullPriceStockFromDaraz } from "../daraz/sync.js";
import { getValidAccessToken } from "../daraz/tokens.js";
import {
  getCategoryAttributes,
  getProducts as searchDarazProducts,
  RESERVED_ATTRIBUTE_KEYS,
  SKU_DIMENSION_FIELDS,
} from "../daraz/client.js";
import { productsCol, storesCol, serializeProduct, type ProductDoc, type StoreDoc, type VariantDoc } from "../daraz/models.js";
import { generateProductDraft } from "../ai/generateProduct.js";

const router = Router();
router.use(requireAuth);
router.use(requireStore);

// Kept in sync with sync.ts's autoMirrorSources - these get derived from
// Title/Description/Highlights automatically, so they're excluded from the
// suggested-attributes list rather than making the user fill in duplicates.
const AUTO_MIRRORED_ATTRIBUTE_KEYS = new Set(["name_en", "description_en", "short_description", "short_description_en"]);

// Fetched here (rather than baked into serializeProduct) so callers that
// don't need the storefront link can skip the extra read.
async function connectedCountry(storeId: string): Promise<string | null> {
  const snap = await storesCol.doc(storeId).get();
  return snap.exists ? (snap.data() as StoreDoc).country : null;
}

// Products from other stores must 404, not just be filtered out of lists -
// otherwise a product id from store A would still be readable/editable
// while store B is selected.
async function ownedProduct(storeId: string, productId: string) {
  const ref = productsCol.doc(productId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as ProductDoc).storeId !== storeId) return null;
  return { ref, snap };
}

// Pagination is opt-in via ?pageSize= - callers that just want the full
// list (e.g. the dashboard's counts) keep working unchanged.
router.get("/", async (req, res) => {
  const storeId = req.session!.currentStoreId!;
  const pageSizeParam = Number(req.query.pageSize);
  const pageSize = req.query.pageSize && pageSizeParam > 0 ? Math.min(100, pageSizeParam) : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  try {
    const baseQuery = productsCol.where("storeId", "==", storeId).orderBy("updatedAt", "desc");
    const listQuery = pageSize ? baseQuery.offset((page - 1) * pageSize).limit(pageSize) : baseQuery;
    const [snap, country, total] = await Promise.all([
      listQuery.get(),
      connectedCountry(storeId),
      pageSize ? baseQuery.count().get().then((c) => c.data().count) : Promise.resolve(null),
    ]);
    const products = snap.docs.map((d) => serializeProduct(d.id, d.data() as ProductDoc, country));
    res.json(
      pageSize && total !== null
        ? { products, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
        : { products },
    );
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/", async (req, res) => {
  const { title, descriptionHtml, vendor, highlights, images, variants } = req.body as {
    title: string;
    descriptionHtml?: string;
    vendor?: string;
    highlights?: string;
    images?: string[];
    variants: Array<{
      sku: string;
      price: string;
      quantity: number;
      compareAtPrice?: string;
      packageWeightKg?: number;
      packageLengthCm?: number;
      packageWidthCm?: number;
      packageHeightCm?: number;
    }>;
  };

  if (!title || !variants?.length) {
    res.status(400).json({ error: "Title and at least one variant (SKU + price) are required" });
    return;
  }

  const now = Timestamp.now();
  const docRef = productsCol.doc();
  const data: ProductDoc = {
    storeId: req.session!.currentStoreId!,
    title,
    descriptionHtml: descriptionHtml ?? null,
    vendor: vendor ?? null,
    highlights: highlights ?? null,
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
      packageWeightKg: v.packageWeightKg ?? null,
      packageLengthCm: v.packageLengthCm ?? null,
      packageWidthCm: v.packageWidthCm ?? null,
      packageHeightCm: v.packageHeightCm ?? null,
    })),
  };

  await docRef.set(data);

  res.status(201).json({ product: serializeProduct(docRef.id, data) });
});

// Draft a product's title/description/highlights/vendor from a rough text
// prompt via Claude - the user still reviews and saves it like any manual edit.
router.post("/generate", async (req, res) => {
  const { prompt } = req.body as { prompt?: string };
  if (!prompt?.trim()) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }
  try {
    const draft = await generateProductDraft(prompt.trim());
    res.json({ draft });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/:id", async (req, res) => {
  const storeId = req.session!.currentStoreId!;
  const [owned, country] = await Promise.all([ownedProduct(storeId, req.params.id), connectedCountry(storeId)]);
  if (!owned) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json({ product: serializeProduct(owned.snap.id, owned.snap.data() as ProductDoc, country) });
});

router.put("/:id", async (req, res) => {
  const { title, descriptionHtml, vendor, highlights, images, variants } = req.body as {
    title?: string;
    descriptionHtml?: string;
    vendor?: string;
    highlights?: string;
    images?: string[];
    variants?: Array<{
      id?: string;
      sku: string;
      price: string;
      quantity: number;
      compareAtPrice?: string;
      packageWeightKg?: number;
      packageLengthCm?: number;
      packageWidthCm?: number;
      packageHeightCm?: number;
    }>;
  };

  const owned = await ownedProduct(req.session!.currentStoreId!, req.params.id);
  if (!owned) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const docRef = owned.ref;

  const update: Record<string, unknown> = { updatedAt: Timestamp.now() };
  if (title !== undefined) update.title = title;
  if (descriptionHtml !== undefined) update.descriptionHtml = descriptionHtml;
  if (vendor !== undefined) update.vendor = vendor;
  if (highlights !== undefined) update.highlights = highlights;
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
        packageWeightKg: v.packageWeightKg ?? null,
        packageLengthCm: v.packageLengthCm ?? null,
        packageWidthCm: v.packageWidthCm ?? null,
        packageHeightCm: v.packageHeightCm ?? null,
      }),
    );
  }

  await docRef.update(update);

  const updated = await docRef.get();
  res.json({ product: serializeProduct(updated.id, updated.data() as ProductDoc) });
});

router.delete("/:id", async (req, res) => {
  const owned = await ownedProduct(req.session!.currentStoreId!, req.params.id);
  if (!owned) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  await owned.ref.delete();
  res.json({ ok: true });
});

// Save (or update) the Daraz category + attribute mapping for a product.
router.put("/:id/mapping", async (req, res) => {
  const { categoryId, attributes } = req.body as {
    categoryId: string;
    attributes: Record<string, string>;
  };

  const owned = await ownedProduct(req.session!.currentStoreId!, req.params.id);
  if (!owned) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const docRef = owned.ref;
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

  const owned = await ownedProduct(req.session!.currentStoreId!, req.params.id);
  if (!owned) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const docRef = owned.ref;
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
  const storeId = req.session!.currentStoreId!;
  try {
    const owned = await ownedProduct(storeId, req.params.id);
    if (!owned) {
      res.status(404).json({ ok: false, error: "Product not found" });
      return;
    }
    const product = owned.snap.data() as ProductDoc;
    await syncProduct(storeId, req.params.id, product.darazItemId ? "update" : "create");
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/:id/suggested-attributes", async (req, res) => {
  const categoryId = String(req.query.categoryId ?? "");
  if (!categoryId) {
    res.json({ suggestions: [], requiredSkuFields: [] });
    return;
  }
  try {
    const session = await getValidAccessToken(req.session!.currentStoreId!);
    if (!session) {
      res.json({ suggestions: [], requiredSkuFields: [] });
      return;
    }
    const categoryAttributes = await getCategoryAttributes(
      { accessToken: session.accessToken, country: session.country },
      categoryId,
    );
    // Daraz's category attribute schema lists basic fields (name/description/
    // brand/package dimensions) alongside real custom attributes, but this
    // app already sends those via their own dedicated inputs - suggesting
    // them here just invites a duplicate, blank override (see buildProductPayload).
    // AUTO_MIRRORED_ATTRIBUTE_KEYS is UI-only - syncProduct still derives and
    // sends these from Title/Description/Highlights, they just don't need a
    // manual duplicate row in the mapping UI.
    const suggestions = categoryAttributes
      .filter((a) => !RESERVED_ATTRIBUTE_KEYS.has(a.name) && !AUTO_MIRRORED_ATTRIBUTE_KEYS.has(a.name))
      .map((a) => ({
        name: a.name,
        label: a.label,
        mandatory: a.mandatory,
        options: a.options,
        skuLevel: a.attributeType === "sku",
      }));
    const requiredSkuFields = categoryAttributes
      .filter((a) => SKU_DIMENSION_FIELDS.includes(a.name) && a.mandatory)
      .map((a) => a.name);
    res.json({ suggestions, requiredSkuFields });
  } catch {
    res.json({ suggestions: [], requiredSkuFields: [] });
  }
});

router.get("/search/daraz", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  if (!query) {
    res.json({ results: [] });
    return;
  }
  try {
    const session = await getValidAccessToken(req.session!.currentStoreId!);
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
    const result = await importDarazProduct(req.session!.currentStoreId!, darazItemId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/import-all", async (req, res) => {
  try {
    const result = await importAllDarazProducts(req.session!.currentStoreId!);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/pull-from-daraz", async (req, res) => {
  try {
    const result = await pullPriceStockFromDaraz(req.session!.currentStoreId!);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
