import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getValidAccessToken } from "./tokens.js";
import {
  createProduct,
  updateProduct,
  updatePriceQuantity,
  uploadImage,
  getProductDetail,
  getProducts,
  getCategoryAttributes,
  effectivePrice,
  DarazApiError,
  type CreateProductInput,
  type DarazSkuDetail,
} from "./client.js";
import { productsCol, type ProductDoc, type VariantDoc } from "./models.js";

async function uploadProductImages(
  darazOpts: { accessToken: string; country: string },
  imageUrls: string[],
): Promise<string[]> {
  const uploaded: string[] = [];
  for (const url of imageUrls) {
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const darazUrl = await uploadImage(darazOpts, buffer);
    uploaded.push(darazUrl);
  }
  return uploaded;
}

// Core sync: builds a Daraz product payload from this app's own product
// record plus its saved category/attribute mapping, then creates or updates
// it on Daraz. Throws on any failure - callers are responsible for
// persisting status.
export async function syncProduct(
  productId: string,
  type: "create" | "update" | "price_qty",
): Promise<void> {
  const docRef = productsCol.doc(productId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new Error(`Product ${productId} not found`);
  }
  const product = snap.data() as ProductDoc;

  if (!product.darazCategoryId || !product.attributesJson) {
    await docRef.update({ syncStatus: "unmapped", updatedAt: Timestamp.now() });
    throw new Error(
      "Product has no Daraz category/attribute mapping yet - map it before syncing",
    );
  }

  const darazSession = await getValidAccessToken();
  if (!darazSession) {
    throw new Error("No connected Daraz account");
  }
  const darazOpts = {
    accessToken: darazSession.accessToken,
    country: darazSession.country,
  };

  // Daraz requires each Sku's own SkuId (its internal id, distinct from our
  // SellerSku) on both update endpoints below, or it rejects with a generic
  // "mandatory field" error. Fetch it live rather than trusting a locally
  // cached value, so this works for products synced here from the start and
  // for ones only linked/imported (which never had a per-variant id stored).
  async function skuIdsBySellerSku(): Promise<Map<string, string>> {
    if (!product.darazItemId) return new Map();
    const detail = await getProductDetail(darazOpts, product.darazItemId);
    return new Map(detail.skus.map((s) => [s.SellerSku, s.SkuId]));
  }

  try {
    // Fast path: only price/quantity changed and the product already exists on Daraz.
    if (type === "price_qty" && product.darazItemId) {
      const skuIds = await skuIdsBySellerSku();
      await updatePriceQuantity(
        darazOpts,
        product.darazItemId,
        product.variants.map((variant) => ({
          SellerSku: variant.sku,
          price: variant.price,
          quantity: String(variant.quantity),
          SkuId: skuIds.get(variant.sku),
        })),
      );
      await docRef.update({ syncStatus: "synced", lastSyncedAt: Timestamp.now(), lastError: null, updatedAt: Timestamp.now() });
      return;
    }

    const imageUrls = JSON.parse(product.imagesJson) as string[];
    const darazImageUrls = await uploadProductImages(darazOpts, imageUrls);
    const skuIds = await skuIdsBySellerSku();

    // The generic attribute map (attributesJson) is a flat key/value bag
    // filled from Daraz's own category schema suggestions, but that schema
    // mixes Product-level attributes with Sku-level ones (e.g. a mandatory
    // "color_family" is Sku-level even for a single-SKU product) - Daraz's
    // create/update APIs don't reject a Sku-level attribute sent as a
    // Product one, they just silently ignore it, so this has to route each
    // key correctly rather than dumping everything into <Attributes>.
    const allAttributes = JSON.parse(product.attributesJson) as Record<string, string>;
    const categoryAttributes = await getCategoryAttributes(darazOpts, product.darazCategoryId).catch(() => []);
    const skuLevelKeys = new Set(
      categoryAttributes.filter((a) => a.attributeType === "sku").map((a) => a.name),
    );
    const productAttributes: Record<string, string> = {};
    const skuLevelAttributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(allAttributes)) {
      (skuLevelKeys.has(key) ? skuLevelAttributes : productAttributes)[key] = value;
    }

    const input: CreateProductInput = {
      primaryCategoryId: product.darazCategoryId,
      name: product.title,
      description: product.descriptionHtml || product.title,
      brandName: product.vendor || undefined,
      attributes: productAttributes,
      images: darazImageUrls,
      skus: product.variants.map((variant) => ({
        SellerSku: variant.sku,
        price: variant.price,
        quantity: String(variant.quantity),
        Images: darazImageUrls,
        ...(skuIds.has(variant.sku) ? { SkuId: skuIds.get(variant.sku) } : {}),
        ...(variant.packageWeightKg != null ? { package_weight: String(variant.packageWeightKg) } : {}),
        ...(variant.packageLengthCm != null ? { package_length: String(variant.packageLengthCm) } : {}),
        ...(variant.packageWidthCm != null ? { package_width: String(variant.packageWidthCm) } : {}),
        ...(variant.packageHeightCm != null ? { package_height: String(variant.packageHeightCm) } : {}),
        ...skuLevelAttributes,
      })),
    };

    if (product.darazItemId) {
      await updateProduct(darazOpts, product.darazItemId, input);
      await docRef.update({ syncStatus: "synced", lastSyncedAt: Timestamp.now(), lastError: null, updatedAt: Timestamp.now() });
    } else {
      const created = await createProduct(darazOpts, input);
      const firstSku = created.sku_list[0];
      await docRef.update({
        darazItemId: created.item_id,
        darazSkuId: firstSku?.SkuId ?? null,
        syncStatus: "synced",
        lastSyncedAt: Timestamp.now(),
        lastError: null,
        updatedAt: Timestamp.now(),
      });
    }
  } catch (error) {
    const message =
      error instanceof DarazApiError ? error.fullMessage : error instanceof Error ? error.message : String(error);
    await docRef.update({ syncStatus: "error", lastError: message, updatedAt: Timestamp.now() });
    throw new Error(message);
  }
}

export interface ImportResult {
  productId: string;
  warnings: string[];
}

// Creates a brand-new local product from a Daraz listing that has no local
// counterpart yet - the reverse of syncProduct.
export async function importDarazProduct(darazItemId: string): Promise<ImportResult> {
  const warnings: string[] = [];
  const darazSession = await getValidAccessToken();
  if (!darazSession) {
    throw new Error("No connected Daraz account");
  }
  const darazOpts = {
    accessToken: darazSession.accessToken,
    country: darazSession.country,
  };

  const detail = await getProductDetail(darazOpts, darazItemId);

  if (detail.images.length === 0) {
    warnings.push("Daraz returned no images for this product");
  }

  const now = Timestamp.now();
  const docRef = productsCol.doc();
  const data: ProductDoc = {
    title: detail.name,
    descriptionHtml: detail.description ?? null,
    vendor: detail.brand ?? null,
    imagesJson: JSON.stringify(detail.images),
    darazItemId: detail.item_id,
    darazSkuId: detail.skus[0]?.SkuId ?? null,
    darazCategoryId: detail.primary_category,
    attributesJson: null,
    syncStatus: "synced",
    lastSyncedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    variants: detail.skus.map((sku: DarazSkuDetail) => {
      const { price, compareAtPrice } = effectivePrice(sku);
      return {
        id: randomUUID(),
        sku: sku.SellerSku,
        price,
        compareAtPrice: compareAtPrice ?? null,
        quantity: Number(sku.quantity ?? 0),
        packageWeightKg: sku.packageWeightKg ?? null,
        packageLengthCm: sku.packageLengthCm ?? null,
        packageWidthCm: sku.packageWidthCm ?? null,
        packageHeightCm: sku.packageHeightCm ?? null,
      };
    }),
  };

  await docRef.set(data);

  return { productId: docRef.id, warnings };
}

export interface ImportAllResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// Bulk version of importDarazProduct - pages through the seller's entire
// Daraz catalog and imports anything not already linked to a local product.
// Idempotent (matches on darazItemId), so it's safe to re-run if it gets cut
// off partway (e.g. a serverless function timeout on a large catalog) - it
// picks up where it left off instead of duplicating.
export async function importAllDarazProducts(): Promise<ImportAllResult> {
  const darazSession = await getValidAccessToken();
  if (!darazSession) {
    throw new Error("No connected Daraz account");
  }
  const darazOpts = {
    accessToken: darazSession.accessToken,
    country: darazSession.country,
  };

  const existingSnap = await productsCol.get();
  const linkedItemIds = new Set(
    existingSnap.docs
      .map((d) => (d.data() as ProductDoc).darazItemId)
      .filter((id): id is string => Boolean(id)),
  );

  const result: ImportAllResult = { imported: 0, skipped: 0, errors: [] };
  const limit = 50;
  let offset = 0;

  while (true) {
    const batch = await getProducts(darazOpts, { limit, offset });
    if (batch.length === 0) break;

    for (const item of batch) {
      if (linkedItemIds.has(item.item_id)) {
        result.skipped++;
        continue;
      }
      try {
        await importDarazProduct(item.item_id);
        linkedItemIds.add(item.item_id);
        result.imported++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${item.item_id}: ${message}`);
      }
    }

    if (batch.length < limit) break;
    offset += limit;
  }

  return result;
}

export interface PullResult {
  productsChecked: number;
  productsUpdated: number;
  errors: string[];
}

// Authority split for already-mapped products: this app owns content
// (pushed via syncProduct), Daraz owns price/stock - Daraz's current values
// always win here, since price/stock is often adjusted directly in Daraz's
// seller tools. Matches by SellerSku, which both import and sync use as the
// variant's sku field.
export async function pullPriceStockFromDaraz(): Promise<PullResult> {
  const darazSession = await getValidAccessToken();
  if (!darazSession) {
    throw new Error("No connected Daraz account");
  }
  const darazOpts = {
    accessToken: darazSession.accessToken,
    country: darazSession.country,
  };

  const snap = await productsCol.get();
  const products = snap.docs.filter((d) => (d.data() as ProductDoc).darazItemId);

  const result: PullResult = { productsChecked: 0, productsUpdated: 0, errors: [] };

  for (const doc of products) {
    const product = doc.data() as ProductDoc;
    result.productsChecked++;
    try {
      const detail = await getProductDetail(darazOpts, product.darazItemId!);
      const skuByName = new Map(detail.skus.map((sku) => [sku.SellerSku, sku]));

      let updated = false;
      const newVariants: VariantDoc[] = product.variants.map((variant) => {
        const sku = skuByName.get(variant.sku);
        if (!sku) return variant;

        const { price, compareAtPrice } = effectivePrice(sku);
        const quantity = Number(sku.quantity ?? 0);
        const changed =
          price !== variant.price ||
          (compareAtPrice ?? null) !== variant.compareAtPrice ||
          (Number.isFinite(quantity) && quantity !== variant.quantity);

        if (!changed) return variant;
        updated = true;
        return {
          ...variant,
          price,
          compareAtPrice: compareAtPrice ?? null,
          quantity: Number.isFinite(quantity) ? quantity : variant.quantity,
        };
      });

      if (updated) {
        result.productsUpdated++;
      }

      await doc.ref.update({
        variants: newVariants,
        lastSyncedAt: Timestamp.now(),
        lastError: null,
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${product.title}: ${message}`);
      await doc.ref.update({ lastError: message, updatedAt: Timestamp.now() });
    }
  }

  return result;
}
