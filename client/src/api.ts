async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = (body && (body.error as string)) || response.statusText;
    throw new Error(message);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  quantity: number;
  packageWeightKg: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
}

export type SyncStatus = "unmapped" | "pending" | "synced" | "error";

export interface Product {
  id: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  imagesJson: string;
  darazCategoryId: string | null;
  attributesJson: string | null;
  darazItemId: string | null;
  darazSkuId: string | null;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  variants: ProductVariant[];
}

export interface DarazOrderItem {
  id: string;
  orderId: string;
  darazOrderItemId: string;
  sku: string | null;
  name: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  status: string | null;
}

export interface DarazOrder {
  id: string;
  darazOrderId: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string;
  itemsCount: number;
  totalAmount: string | null;
  currency: string | null;
  darazCreatedAt: string | null;
  darazUpdatedAt: string | null;
  importedAt: string;
  items: DarazOrderItem[];
}

export interface DarazCategoryNode {
  id: string;
  name: string;
  isLeaf: boolean;
  children: DarazCategoryNode[];
}

export interface DarazExistingProduct {
  item_id: string;
  primary_category: string;
  attributes: { name?: string };
  skus: Array<{ SkuId: string; SellerSku: string; price: string; quantity: string }>;
}
