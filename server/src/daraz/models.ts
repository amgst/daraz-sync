import { Timestamp } from "firebase-admin/firestore";
import db from "../db.js";
import { darazProductUrl } from "./countries.js";

function toIso(value: Timestamp | null | undefined): string | null {
  return value ? value.toDate().toISOString() : null;
}

export type SyncStatus = "unmapped" | "pending" | "synced" | "error";

// --- Stores (one doc per connected Daraz seller account - this app supports
// several stores under one shared login, switched via the session's
// currentStoreId) ---

export interface StoreDoc {
  name: string;
  // null = admin-owned / no individual customer owner (e.g. stores that
  // existed before per-customer ownership was introduced).
  ownerUserId: string | null;
  country: string;
  sellerId: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Timestamp;
  refreshTokenExpiresAt: Timestamp;
  createdAt: Timestamp;
  connectedAt: Timestamp;
  updatedAt: Timestamp;
}

export const storesCol = db.collection("stores");

// --- Products (variants embedded - always read/written together with the product) ---

export interface VariantDoc {
  id: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  quantity: number;
  packageWeightKg: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
}

export interface ProductDoc {
  storeId: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  // Daraz's "Highlights" field - distinct from descriptionHtml (Daraz's own
  // "Product Description"), not just a shorter version of it.
  highlights: string | null;
  imagesJson: string;
  darazCategoryId: string | null;
  attributesJson: string | null;
  darazItemId: string | null;
  darazSkuId: string | null;
  syncStatus: SyncStatus;
  lastSyncedAt: Timestamp | null;
  lastError: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  variants: VariantDoc[];
}

export const productsCol = db.collection("products");

// `country` is the owning store's country/site - needed to build the
// storefront link since each site has its own domain. Omitted (null
// darazUrl) where the caller hasn't looked up the store, e.g. contexts that
// don't need the link.
export function serializeProduct(id: string, data: ProductDoc, country?: string | null) {
  return {
    id,
    title: data.title,
    descriptionHtml: data.descriptionHtml,
    vendor: data.vendor,
    highlights: data.highlights,
    imagesJson: data.imagesJson,
    darazCategoryId: data.darazCategoryId,
    attributesJson: data.attributesJson,
    darazItemId: data.darazItemId,
    darazSkuId: data.darazSkuId,
    darazUrl: data.darazItemId && country ? darazProductUrl(country, data.darazItemId) : null,
    syncStatus: data.syncStatus,
    lastSyncedAt: toIso(data.lastSyncedAt),
    lastError: data.lastError,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    variants: data.variants.map((v) => ({ ...v, productId: id })),
  };
}

// --- Daraz orders (items embedded; doc id = `${storeId}_${darazOrderId}` so
// two stores' orders can never collide, so import is still a plain
// upsert-by-id with no separate uniqueness lookup) ---

export interface OrderItemDoc {
  id: string;
  darazOrderItemId: string;
  sku: string | null;
  name: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  status: string | null;
}

export interface OrderDoc {
  storeId: string;
  darazOrderId: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string;
  itemsCount: number;
  totalAmount: string | null;
  currency: string | null;
  darazCreatedAt: Timestamp | null;
  darazUpdatedAt: Timestamp | null;
  importedAt: Timestamp;
  updatedAt: Timestamp;
  items: OrderItemDoc[];
}

export const ordersCol = db.collection("darazOrders");

export function serializeOrder(id: string, data: OrderDoc) {
  return {
    id,
    darazOrderId: data.darazOrderId,
    orderNumber: data.orderNumber,
    customerName: data.customerName,
    status: data.status,
    itemsCount: data.itemsCount,
    totalAmount: data.totalAmount,
    currency: data.currency,
    darazCreatedAt: toIso(data.darazCreatedAt),
    darazUpdatedAt: toIso(data.darazUpdatedAt),
    importedAt: toIso(data.importedAt),
    items: data.items.map((item) => ({ ...item, orderId: id })),
  };
}
