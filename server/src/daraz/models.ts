import { Timestamp } from "firebase-admin/firestore";
import db from "../db.js";

function toIso(value: Timestamp | null | undefined): string | null {
  return value ? value.toDate().toISOString() : null;
}

export type SyncStatus = "unmapped" | "pending" | "synced" | "error";

// --- Daraz account (singleton doc, one Daraz seller connection per app instance) ---

export interface DarazAccountDoc {
  country: string;
  sellerId: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Timestamp;
  refreshTokenExpiresAt: Timestamp;
  connectedAt: Timestamp;
  updatedAt: Timestamp;
}

export const accountRef = db.collection("darazAccounts").doc("singleton");

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
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
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

export function serializeProduct(id: string, data: ProductDoc) {
  return {
    id,
    title: data.title,
    descriptionHtml: data.descriptionHtml,
    vendor: data.vendor,
    imagesJson: data.imagesJson,
    darazCategoryId: data.darazCategoryId,
    attributesJson: data.attributesJson,
    darazItemId: data.darazItemId,
    darazSkuId: data.darazSkuId,
    syncStatus: data.syncStatus,
    lastSyncedAt: toIso(data.lastSyncedAt),
    lastError: data.lastError,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    variants: data.variants.map((v) => ({ ...v, productId: id })),
  };
}

// --- Daraz orders (items embedded; doc id = Daraz's own order id, so
// import is a plain upsert-by-id with no separate uniqueness lookup) ---

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
