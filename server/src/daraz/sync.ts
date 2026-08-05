import db from "../db.js";
import { getValidAccessToken } from "./tokens.js";
import {
  createProduct,
  updateProduct,
  updatePriceQuantity,
  uploadImage,
  getProductDetail,
  effectivePrice,
  type CreateProductInput,
  type DarazSkuDetail,
} from "./client.js";
import type { Product, ProductVariant } from "@prisma/client";

type ProductWithVariants = Product & { variants: ProductVariant[] };

async function uploadProductImages(
  darazOpts: { accessToken: string; country: string },
  imageUrls: string[],
): Promise<string[]> {
  const uploaded: string[] = [];
  for (const url of imageUrls) {
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const darazUrl = await uploadImage(darazOpts, buffer.toString("base64"));
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
  const product = (await db.product.findUnique({
    where: { id: productId },
    include: { variants: true },
  })) as ProductWithVariants | null;

  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  if (!product.darazCategoryId || !product.attributesJson) {
    await db.product.update({
      where: { id: productId },
      data: { syncStatus: "unmapped" },
    });
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

  // Fast path: only price/quantity changed and the product already exists on Daraz.
  if (type === "price_qty" && product.darazItemId) {
    await updatePriceQuantity(
      darazOpts,
      product.darazItemId,
      product.variants.map((variant) => ({
        SellerSku: variant.sku,
        price: variant.price,
        quantity: String(variant.quantity),
      })),
    );
    await db.product.update({
      where: { id: productId },
      data: { syncStatus: "synced", lastSyncedAt: new Date(), lastError: null },
    });
    return;
  }

  const imageUrls = JSON.parse(product.imagesJson) as string[];
  const darazImageUrls = await uploadProductImages(darazOpts, imageUrls);

  const input: CreateProductInput = {
    primaryCategoryId: product.darazCategoryId,
    name: product.title,
    description: product.descriptionHtml || product.title,
    brandName: product.vendor || undefined,
    attributes: JSON.parse(product.attributesJson) as Record<string, string>,
    skus: product.variants.map((variant) => ({
      SellerSku: variant.sku,
      price: variant.price,
      quantity: String(variant.quantity),
      Images: darazImageUrls,
    })),
  };

  if (product.darazItemId) {
    await updateProduct(darazOpts, product.darazItemId, input);
    await db.product.update({
      where: { id: productId },
      data: { syncStatus: "synced", lastSyncedAt: new Date(), lastError: null },
    });
  } else {
    const created = await createProduct(darazOpts, input);
    const firstSku = created.sku_list[0];
    await db.product.update({
      where: { id: productId },
      data: {
        darazItemId: created.item_id,
        darazSkuId: firstSku?.SkuId ?? null,
        syncStatus: "synced",
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });
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

  const product = await db.product.create({
    data: {
      title: detail.name,
      descriptionHtml: detail.description,
      vendor: detail.brand ?? undefined,
      imagesJson: JSON.stringify(detail.images),
      darazItemId: detail.item_id,
      darazSkuId: detail.skus[0]?.SkuId ?? null,
      darazCategoryId: detail.primary_category,
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      variants: {
        create: detail.skus.map((sku: DarazSkuDetail) => {
          const { price, compareAtPrice } = effectivePrice(sku);
          return {
            sku: sku.SellerSku,
            price,
            compareAtPrice: compareAtPrice ?? undefined,
            quantity: Number(sku.quantity ?? 0),
            packageWeightKg: sku.packageWeightKg ?? undefined,
          };
        }),
      },
    },
  });

  return { productId: product.id, warnings };
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

  const products = await db.product.findMany({
    where: { darazItemId: { not: null } },
    include: { variants: true },
  });

  const result: PullResult = { productsChecked: 0, productsUpdated: 0, errors: [] };

  for (const product of products) {
    result.productsChecked++;
    try {
      const detail = await getProductDetail(darazOpts, product.darazItemId!);
      const variantBySku = new Map(product.variants.map((v) => [v.sku, v]));

      let updated = false;
      for (const sku of detail.skus) {
        const variant = variantBySku.get(sku.SellerSku);
        if (!variant) continue;

        const { price, compareAtPrice } = effectivePrice(sku);
        const quantity = Number(sku.quantity ?? 0);
        const changed =
          price !== variant.price ||
          (compareAtPrice ?? null) !== (variant.compareAtPrice ?? null) ||
          (Number.isFinite(quantity) && quantity !== variant.quantity);

        if (changed) {
          await db.productVariant.update({
            where: { id: variant.id },
            data: {
              price,
              compareAtPrice: compareAtPrice ?? null,
              ...(Number.isFinite(quantity) ? { quantity } : {}),
            },
          });
          updated = true;
        }
      }

      if (updated) {
        result.productsUpdated++;
      }

      await db.product.update({
        where: { id: product.id },
        data: { lastSyncedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${product.title}: ${message}`);
      await db.product.update({
        where: { id: product.id },
        data: { lastError: message },
      });
    }
  }

  return result;
}
