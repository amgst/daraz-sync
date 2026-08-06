import crypto from "node:crypto";
import {
  apiHostFor,
  oauthHostFor,
  getDarazAppCredentials,
  getDarazRedirectUri,
} from "./config.js";

// Daraz Open Platform is built on the same "IOP" gateway framework as
// Lazada Open Platform. Every call - authenticated or not - is signed the
// same way:
//   1. system params (app_key, timestamp, sign_method) + business params
//   2. sort params by key (byte order)
//   3. concatenate: apiPath + key1 + value1 + key2 + value2 + ...
//   4. HMAC-SHA256 with app_secret, uppercase hex
// NOTE: exact business-parameter shapes for each endpoint below should be
// cross-checked against the live docs at open.daraz.com/doc/api.htm before
// relying on them in production - the signing/transport layer is standard
// IOP and can be trusted as-is.
function sign(apiPath: string, params: Record<string, string>, appSecret: string): string {
  const sortedKeys = Object.keys(params).sort();
  let base = apiPath;
  for (const key of sortedKeys) {
    base += key + params[key];
  }
  return crypto
    .createHmac("sha256", appSecret)
    .update(base, "utf8")
    .digest("hex")
    .toUpperCase();
}

interface RequestOptions {
  apiPath: string;
  params?: Record<string, string>;
  accessToken?: string;
  apiHost: string;
  method?: "GET" | "POST";
}

// Daraz's write-endpoint validation errors come back in the seller
// account's configured market language (Urdu, for this PK account) -
// confirmed live that the `language_code` request param (which does work on
// the read-only category endpoints) has no effect here, and there's no
// other documented override. Best-effort substring translation of the
// specific Urdu fragments seen in practice, so this app's own error display
// stays in English even when Daraz's raw text doesn't. Not exhaustive -
// anything not in this table passes through untranslated.
const DARAZ_UR_EN_PHRASES: Array<[string, string]> = [
  ["قیمت اور اسٹاک", "Price and Stock"],
  ["پیکیج کا وزن (کلوگرام)", "Package Weight (kg)"],
  ["پیکیج کی اونچائی (سینٹی میٹر)", "Package Height (cm)"],
  ["پیکیج کی لمبائی (سینٹی میٹر)", "Package Length (cm)"],
  ["پیکیج کی چوڑائی (سینٹی میٹر)", "Package Width (cm)"],
  [
    "آٹریبوٹس کی قدر جو آپ داخل کرتے ہیں دی گئی ڈراپ ڈاؤن فہرست میں شامل نہیں ہے۔ غلطی سے بچنے کے لیے براہ کرم ڈراپ ڈاؤن سے منتخب کریں",
    "The value you entered is not in the allowed dropdown list. Please select a value from the dropdown instead.",
  ],
  ["درکار ہے لیکن غائب ہے۔ براہ کرم دوبارہ اپ لوڈ کرنے سے پہلے معلومات کو پُر کریں۔", "is required but missing. Please fill it in before re-uploading."],
  ["cannot be blank. Kindly input the information before re-uploading.", "cannot be blank. Please fill it in before re-uploading."],
];

function translateDarazMessage(message: string): string {
  let translated = message;
  for (const [ur, en] of DARAZ_UR_EN_PHRASES) {
    translated = translated.split(ur).join(en);
  }
  return translated;
}

export class DarazApiError extends Error {
  code?: string;
  detail?: unknown;
  constructor(message: string, code?: string, detail?: unknown) {
    super(message);
    this.name = "DarazApiError";
    this.code = code;
    this.detail = detail;
  }

  // The top-level `message` (e.g. "E500: Create product failed") is a
  // generic wrapper - the field-level cause lives in `detail`, if Daraz sent
  // one. Fold it in so callers that only look at `.message` (route error
  // responses, Firestore's lastError) still see the real reason.
  get fullMessage(): string {
    if (!Array.isArray(this.detail) || this.detail.length === 0) return this.message;
    const parts = this.detail
      .map((d) => {
        if (!d || typeof d !== "object") return undefined;
        const { field, message } = d as { field?: unknown; message?: unknown };
        if (typeof message !== "string") return undefined;
        const translated = translateDarazMessage(message);
        return typeof field === "string" && field ? `[${field}] ${translated}` : translated;
      })
      .filter((m): m is string => typeof m === "string");
    return parts.length ? `${this.message} - ${parts.join("; ")}` : this.message;
  }
}

async function request<T = unknown>({
  apiPath,
  params = {},
  accessToken,
  apiHost,
  method = "POST",
}: RequestOptions): Promise<T> {
  const { appKey, appSecret } = getDarazAppCredentials();

  const allParams: Record<string, string> = {
    ...params,
    app_key: appKey,
    timestamp: String(Date.now()),
    sign_method: "sha256",
    ...(accessToken ? { access_token: accessToken } : {}),
  };
  allParams.sign = sign(apiPath, allParams, appSecret);

  const url = new URL(apiHost + apiPath);
  const body = new URLSearchParams(allParams);

  const response = await fetch(
    method === "GET" ? `${url.toString()}?${body.toString()}` : url.toString(),
    {
      method,
      headers:
        method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : undefined,
      body: method === "POST" ? body.toString() : undefined,
    },
  );

  const json = (await response.json()) as {
    code?: string;
    type?: string;
    message?: string;
    detail?: unknown;
    data?: unknown;
  } & Record<string, unknown>;

  // IOP-style APIs return HTTP 200 with an error `code` in the body on failure.
  // The top-level message is often a generic wrapper (e.g. "Update product
  // failed") - still log the full response for server-side debugging, but
  // also carry `detail` (the field-level cause) on the thrown error itself
  // so callers don't depend on having access to server logs to see it.
  if (json.code && json.code !== "0") {
    console.error(`[daraz-sync] Daraz API error on ${apiPath}:`, JSON.stringify(json));
    throw new DarazApiError(json.message ?? "Daraz API error", json.code, json.detail);
  }

  return json as T;
}

// ---- OAuth ----
// The authorize page and token endpoints live on the seller's own country
// host (e.g. https://api.daraz.pk), not a separate global auth host - so the
// country has to be chosen before we can build this URL.

export function getAuthorizeUrl(state: string, country: string): string {
  const { appKey } = getDarazAppCredentials();
  const url = new URL("/oauth/authorize", oauthHostFor(country));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("force_auth", "true");
  url.searchParams.set("client_id", appKey);
  url.searchParams.set("redirect_uri", getDarazRedirectUri());
  url.searchParams.set("state", state);
  return url.toString();
}

export interface DarazTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  refresh_expires_in: number; // seconds
  account: string;
  account_id?: string;
  country_user_info?: Array<{
    country: string;
    seller_id: string;
    short_code: string;
  }>;
}

export async function exchangeCodeForToken(
  code: string,
  country: string,
): Promise<DarazTokenResponse> {
  return request<DarazTokenResponse>({
    apiPath: "/auth/token/create",
    params: { code },
    apiHost: apiHostFor(country),
  });
}

export async function refreshAccessToken(
  refreshToken: string,
  country: string,
): Promise<DarazTokenResponse> {
  return request<DarazTokenResponse>({
    apiPath: "/auth/token/refresh",
    params: { refresh_token: refreshToken },
    apiHost: apiHostFor(country),
  });
}

// ---- Product ----

export interface DarazSku {
  SellerSku: string;
  price: string;
  quantity: string;
  Images?: string[];
  [attribute: string]: string | string[] | undefined;
}

export interface CreateProductInput {
  primaryCategoryId: string;
  name: string;
  description: string;
  brandName?: string;
  attributes: Record<string, string>;
  images: string[];
  skus: DarazSku[];
}

interface DarazProductClientOptions {
  accessToken: string;
  country: string;
}

// Unlike every other call in this client, image upload takes the file itself
// as multipart/form-data rather than a signed urlencoded business param -
// confirmed against a live call after the urlencoded-base64 approach failed
// with "mandatory parameter image not supplied". The signature only covers
// the system params (app_key/timestamp/sign_method/access_token); the file
// bytes aren't part of it.
export async function uploadImage(
  { accessToken, country }: DarazProductClientOptions,
  imageBuffer: Buffer,
): Promise<string> {
  const { appKey, appSecret } = getDarazAppCredentials();
  const apiPath = "/image/upload";
  const systemParams: Record<string, string> = {
    app_key: appKey,
    timestamp: String(Date.now()),
    sign_method: "sha256",
    access_token: accessToken,
  };
  systemParams.sign = sign(apiPath, systemParams, appSecret);

  const url = new URL(apiHostFor(country) + apiPath);
  for (const [key, value] of Object.entries(systemParams)) url.searchParams.set(key, value);

  const form = new FormData();
  form.append("image", new Blob([imageBuffer]), "image.jpg");

  const response = await fetch(url.toString(), { method: "POST", body: form });
  const json = (await response.json()) as {
    code?: string;
    message?: string;
    detail?: unknown;
    data?: { image?: { url?: string } };
  };
  if (json.code && json.code !== "0") {
    console.error(`[daraz-sync] Daraz API error on ${apiPath}:`, JSON.stringify(json));
    throw new DarazApiError(json.message ?? "Daraz API error", json.code, json.detail);
  }
  if (!json.data?.image?.url) {
    throw new DarazApiError("Daraz image upload returned no URL");
  }
  return json.data.image.url;
}

export async function createProduct(
  { accessToken, country }: DarazProductClientOptions,
  input: CreateProductInput,
): Promise<{ item_id: string; sku_list: Array<{ SellerSku: string; SkuId: string }> }> {
  const payload = buildProductPayload(input);
  const result = await request<{
    data: {
      item_id: string;
      sku_list: Array<{ SellerSku: string; SkuId: string }>;
    };
  }>({
    apiPath: "/product/create",
    params: { payload },
    accessToken,
    apiHost: apiHostFor(country),
  });
  return result.data;
}

export async function updateProduct(
  { accessToken, country }: DarazProductClientOptions,
  itemId: string,
  input: CreateProductInput,
): Promise<void> {
  const payload = buildProductPayload(input, itemId);
  await request({
    apiPath: "/product/update",
    params: { payload },
    accessToken,
    apiHost: apiHostFor(country),
  });
}

export async function updatePriceQuantity(
  { accessToken, country }: DarazProductClientOptions,
  itemId: string,
  skus: Array<{ SellerSku: string; price: string; quantity: string; SkuId?: string }>,
): Promise<void> {
  const skusXml = skus
    .map(
      (sku) =>
        `<Sku>${sku.SkuId ? `<SkuId>${escapeXml(sku.SkuId)}</SkuId>` : ""}<SellerSku>${escapeXml(sku.SellerSku)}</SellerSku><price>${sku.price}</price><quantity>${sku.quantity}</quantity></Sku>`,
    )
    .join("");
  const payload = `<Request><Product><Item><ItemId>${itemId}</ItemId></Item><Skus>${skusXml}</Skus></Product></Request>`;
  await request({
    apiPath: "/product/price_quantity/update",
    params: { payload },
    accessToken,
    apiHost: apiHostFor(country),
  });
}

export interface DarazExistingProduct {
  item_id: string;
  primary_category: string;
  attributes: { name?: string };
  skus: Array<{ SkuId: string; SellerSku: string; price: string; quantity: string }>;
}

// Searches the seller's existing Daraz catalog - used to link an
// already-listed Daraz product to a local product instead of creating a
// duplicate, or to browse the catalog for import. Daraz returns
// item_id/primary_category/SkuId as raw JSON numbers despite the rest of
// this client treating them as strings - coerce everything ID-shaped right
// at the parse boundary so no downstream caller has to think about it.
function normalizeExistingProduct(raw: {
  item_id: unknown;
  primary_category: unknown;
  attributes: { name?: string };
  skus: Array<{ SkuId: unknown; SellerSku: unknown; price: unknown; quantity: unknown }>;
}): DarazExistingProduct {
  return {
    item_id: String(raw.item_id),
    primary_category: String(raw.primary_category),
    attributes: raw.attributes,
    skus: raw.skus.map((sku) => ({
      SkuId: String(sku.SkuId),
      SellerSku: String(sku.SellerSku),
      price: String(sku.price),
      quantity: String(sku.quantity),
    })),
  };
}

export async function getProducts(
  { accessToken, country }: DarazProductClientOptions,
  filter: { sellerSku?: string; search?: string; limit?: number; offset?: number },
): Promise<DarazExistingProduct[]> {
  const result = await request<{
    data: { products: Parameters<typeof normalizeExistingProduct>[0][] };
  }>({
    apiPath: "/products/get",
    params: {
      filter: "all",
      limit: String(filter.limit ?? 20),
      offset: String(filter.offset ?? 0),
      ...(filter.sellerSku ? { sku_seller_list: JSON.stringify([filter.sellerSku]) } : {}),
      ...(filter.search ? { search: filter.search } : {}),
    },
    accessToken,
    apiHost: apiHostFor(country),
    method: "GET",
  });
  return (result.data?.products ?? []).map(normalizeExistingProduct);
}

export interface DarazSkuDetail {
  SkuId: string;
  SellerSku: string;
  price: string;
  quantity: string;
  images: string[];
  saleProp: Record<string, string>;
  specialPrice: string | null;
  specialFromDate: string | null;
  specialToDate: string | null;
  packageWeightKg: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
}

export interface DarazVariationDef {
  key: string; // e.g. "color_family" - matches the keys in each sku's saleProp
  label: string; // e.g. "Color Family" - human-readable option name
}

export interface DarazProductDetail {
  item_id: string;
  primary_category: string;
  name: string;
  description: string;
  brand: string | null;
  images: string[];
  variations: DarazVariationDef[];
  skus: DarazSkuDetail[];
}

// Confirmed against a real /product/item/get response: images are a plain
// top-level string array, price/special_price are separate fields
// (special_price only actually applies within special_from_date/to_date),
// and per-SKU option values live in `saleProp` (e.g. {color_family:
// "Brown"}), with `variation.VariationN.name`/`label` giving the matching
// human-readable option name for each saleProp key.
export async function getProductDetail(
  { accessToken, country }: DarazProductClientOptions,
  itemId: string,
): Promise<DarazProductDetail> {
  const result = await request<{
    data: {
      item_id: unknown;
      primary_category: unknown;
      images?: string[];
      attributes: {
        name?: string;
        description?: string;
        short_description?: string;
        brand?: string;
      };
      variation?: Record<string, { name: string; label: string }>;
      skus: Array<{
        SkuId: unknown;
        SellerSku: unknown;
        price: unknown;
        quantity: unknown;
        Images?: string[];
        saleProp?: Record<string, unknown>;
        special_price?: unknown;
        special_from_date?: string;
        special_to_date?: string;
        package_weight?: unknown;
        package_length?: unknown;
        package_width?: unknown;
        package_height?: unknown;
      }>;
    };
  }>({
    apiPath: "/product/item/get",
    params: { item_id: itemId },
    accessToken,
    apiHost: apiHostFor(country),
    method: "GET",
  });

  const data = result.data;

  const variations = Object.values(data.variation ?? {}).map((v) => ({
    key: v.name,
    label: v.label,
  }));

  const toFiniteOrNull = (value: unknown): number | null => {
    if (value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const skus: DarazSkuDetail[] = data.skus.map((sku) => ({
    SkuId: String(sku.SkuId),
    SellerSku: String(sku.SellerSku),
    price: String(sku.price),
    quantity: String(sku.quantity),
    images: sku.Images ?? [],
    saleProp: Object.fromEntries(
      Object.entries(sku.saleProp ?? {}).map(([k, v]) => [k, String(v)]),
    ),
    specialPrice: sku.special_price !== undefined ? String(sku.special_price) : null,
    specialFromDate: sku.special_from_date ?? null,
    specialToDate: sku.special_to_date ?? null,
    packageWeightKg: toFiniteOrNull(sku.package_weight),
    packageLengthCm: toFiniteOrNull(sku.package_length),
    packageWidthCm: toFiniteOrNull(sku.package_width),
    packageHeightCm: toFiniteOrNull(sku.package_height),
  }));

  const images =
    data.images ?? skus.flatMap((sku) => sku.images).filter((v, i, a) => a.indexOf(v) === i);

  return {
    item_id: String(data.item_id),
    primary_category: String(data.primary_category),
    name: data.attributes?.name ?? `Daraz item ${data.item_id}`,
    description: data.attributes?.description ?? data.attributes?.short_description ?? "",
    brand: data.attributes?.brand && data.attributes.brand !== "No Brand" ? data.attributes.brand : null,
    images,
    variations,
    skus,
  };
}

// A sku's special_price only actually applies to purchases within its date
// window - outside that window it's stale and the regular price should win.
export function effectivePrice(sku: DarazSkuDetail): { price: string; compareAtPrice: string | null } {
  if (!sku.specialPrice || !sku.specialFromDate || !sku.specialToDate) {
    return { price: sku.price, compareAtPrice: null };
  }
  const now = Date.now();
  const from = new Date(sku.specialFromDate).getTime();
  const to = new Date(sku.specialToDate).getTime();
  if (Number.isFinite(from) && Number.isFinite(to) && now >= from && now <= to) {
    return { price: sku.specialPrice, compareAtPrice: sku.price };
  }
  return { price: sku.price, compareAtPrice: null };
}

// Debug-only: returns the untouched raw JSON for a product, bypassing all
// the field-name guessing above.
export async function getRawProductDetail(
  { accessToken, country }: DarazProductClientOptions,
  itemId: string,
): Promise<unknown> {
  return request({
    apiPath: "/product/item/get",
    params: { item_id: itemId },
    accessToken,
    apiHost: apiHostFor(country),
    method: "GET",
  });
}

export interface DarazCategoryNode {
  id: string;
  name: string;
  isLeaf: boolean;
  children: DarazCategoryNode[];
}

// Normalizes the raw category tree response into a consistent shape - the
// exact field names (category_id vs id, children vs sub_category_list) are
// unverified against live docs, so this tries the common IOP/Lazada variants
// and silently drops anything it can't recognize rather than throwing.
function normalizeCategoryNode(raw: unknown): DarazCategoryNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.category_id ?? obj.categoryId ?? obj.id;
  const name = obj.name ?? obj.name_local ?? obj.category_name;
  if (id === undefined || id === null || typeof name !== "string") return null;

  const rawChildren =
    (obj.children as unknown[]) ??
    (obj.sub_category_list as unknown[]) ??
    (obj.child_category_list as unknown[]) ??
    [];
  const children = Array.isArray(rawChildren)
    ? rawChildren.map(normalizeCategoryNode).filter((n): n is DarazCategoryNode => n !== null)
    : [];

  const isLeaf =
    typeof obj.leaf === "boolean" ? obj.leaf : children.length === 0;

  return { id: String(id), name, isLeaf, children };
}

export async function getCategoryTree(
  { accessToken, country }: DarazProductClientOptions,
): Promise<DarazCategoryNode[]> {
  const result = await request<{ data?: unknown[] }>({
    apiPath: "/category/tree/get",
    params: { language_code: "en" },
    accessToken,
    apiHost: apiHostFor(country),
    method: "GET",
  });
  const raw = Array.isArray(result.data) ? result.data : [];
  return raw.map(normalizeCategoryNode).filter((n): n is DarazCategoryNode => n !== null);
}

export interface DarazCategoryAttribute {
  name: string;
  label: string;
  mandatory: boolean;
  // Present for dropdown-style fields (input_type "singleSelect" /
  // "multiEnumInput" / etc.) that Daraz will reject any other value for -
  // confirmed live: a category's "color_family" came back with a real
  // options list (Maroon/Red/Black/...), while "brand" was singleSelect
  // with no options here at all (its values come from a separate brand
  // lookup this app doesn't implement, so it stays free text).
  options?: string[];
}

// Field names for the mandatory flag (and the array's location in the
// response envelope) aren't confirmed against live docs - same caveat as
// the category tree normalizer above - so this tries the common IOP/Lazada
// variants rather than assuming one exact shape.
function normalizeCategoryAttribute(raw: unknown): DarazCategoryAttribute | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name = obj.name ?? obj.attribute_name;
  if (typeof name !== "string") return null;
  const label = obj.label ?? obj.display_name ?? name;
  const mandatory = Boolean(obj.is_mandatory ?? obj.mandatory ?? obj.required ?? false);
  const rawOptions = obj.options;
  const options = Array.isArray(rawOptions)
    ? rawOptions
        .map((o) => (o && typeof o === "object" ? (o as { name?: unknown }).name : o))
        .filter((n): n is string => typeof n === "string")
    : undefined;
  return {
    name,
    label: typeof label === "string" ? label : name,
    mandatory,
    ...(options && options.length ? { options } : {}),
  };
}

export async function getCategoryAttributes(
  { accessToken, country }: DarazProductClientOptions,
  categoryId: string,
): Promise<DarazCategoryAttribute[]> {
  const result = await request<{ data?: unknown }>({
    apiPath: "/category/attributes/get",
    params: { primary_category_id: categoryId, language_code: "en" },
    accessToken,
    apiHost: apiHostFor(country),
    method: "GET",
  });
  const data = result.data;
  const raw = Array.isArray(data)
    ? data
    : Array.isArray((data as { attributes?: unknown[] })?.attributes)
      ? (data as { attributes: unknown[] }).attributes
      : [];
  return raw.map(normalizeCategoryAttribute).filter((a): a is DarazCategoryAttribute => a !== null);
}

// ---- Orders ----
// Follows the general IOP order API shape (Daraz is built on the same
// gateway as Lazada Open Platform) - verify exact field names against the
// live docs before relying on them, same caveat as the category tree above.
const ORDERS_MAX_LIMIT = 100;

function defaultOrdersLookback(days = 3650): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export interface DarazOrderSummary {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string;
  itemsCount: number;
  totalAmount: string | null;
  currency: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getOrders(
  { accessToken, country }: DarazProductClientOptions,
  filter: { createdAfter?: string; offset?: number; limit?: number } = {},
): Promise<DarazOrderSummary[]> {
  const result = await request<{
    data?: {
      orders?: Array<{
        order_id: unknown;
        order_number?: unknown;
        customer_first_name?: string;
        customer_last_name?: string;
        statuses?: string[];
        items_count?: unknown;
        price?: unknown;
        created_at?: string;
        updated_at?: string;
      }>;
    };
  }>({
    apiPath: "/orders/get",
    params: {
      sort_by: "created_at",
      sort_direction: "DESC",
      offset: String(filter.offset ?? 0),
      limit: String(Math.min(filter.limit ?? ORDERS_MAX_LIMIT, ORDERS_MAX_LIMIT)),
      created_after: filter.createdAfter ?? defaultOrdersLookback(),
    },
    accessToken,
    apiHost: apiHostFor(country),
    method: "GET",
  });

  return (result.data?.orders ?? []).map((o) => ({
    orderId: String(o.order_id),
    orderNumber: o.order_number !== undefined ? String(o.order_number) : null,
    customerName:
      [o.customer_first_name, o.customer_last_name].filter(Boolean).join(" ").trim() || null,
    status: o.statuses?.[0] ?? "unknown",
    itemsCount: o.items_count !== undefined ? Number(o.items_count) : 0,
    totalAmount: o.price !== undefined ? String(o.price) : null,
    currency: null,
    createdAt: o.created_at ?? null,
    updatedAt: o.updated_at ?? null,
  }));
}

export interface DarazOrderItemDetail {
  orderItemId: string;
  sku: string | null;
  name: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  status: string | null;
}

export async function getOrderItems(
  { accessToken, country }: DarazProductClientOptions,
  orderId: string,
): Promise<DarazOrderItemDetail[]> {
  const result = await request<{
    data?: Array<{
      order_item_id: unknown;
      sku?: string;
      shop_sku?: string;
      name?: string;
      product_main_image?: string;
      item_price?: unknown;
      currency?: string;
      status?: string;
    }>;
  }>({
    apiPath: "/order/items/get",
    params: { order_id: orderId },
    accessToken,
    apiHost: apiHostFor(country),
    method: "GET",
  });

  return (result.data ?? []).map((item) => ({
    orderItemId: String(item.order_item_id),
    sku: item.sku ?? item.shop_sku ?? null,
    name: item.name ?? null,
    imageUrl: item.product_main_image ?? null,
    price: item.item_price !== undefined ? String(item.item_price) : null,
    currency: item.currency ?? null,
    status: item.status ?? null,
  }));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Basic fields that this payload always sends explicitly (below) - if the
// caller's attribute map also contains one of these (e.g. picked up from
// Daraz's own category attribute schema, which lists them alongside real
// custom attributes), dropping them here prevents a duplicate tag where
// Daraz keeps the first - blank - occurrence and rejects the whole product
// as missing that field.
//
// NOTE: "short_description" is deliberately NOT in this set - confirmed
// against a live category schema that it's a distinct field from
// "description" (Daraz's "Highlights" vs "Product Description"), often
// mandatory on its own, and this app has no dedicated input for it - it
// must stay available as a generic attribute the user can fill in.
// Per-SKU dimension fields (weight/length/width/height) - these live on the
// app's dedicated variant inputs, not the generic attribute map, since
// they're Sku-level fields in the payload, not Product-level Attributes.
export const SKU_DIMENSION_FIELDS = ["package_weight", "package_length", "package_width", "package_height"];

// Daraz's category attribute schema is a flat list mixing Product-level
// Attributes with Sku-level fields (SellerSku/price/quantity) - the latter
// are already sent through the Variants table's dedicated columns, so they
// need reserving too or they hit the same duplicate-tag problem.
export const RESERVED_ATTRIBUTE_KEYS = new Set([
  "name",
  "title",
  "description",
  "brand",
  "SellerSku",
  "price",
  "quantity",
  ...SKU_DIMENSION_FIELDS,
]);

// The product create/update APIs take a single XML `payload` business
// parameter (not individual form fields) - this mirrors the IOP product API
// shape; verify the exact tag set against the live docs before shipping.
function buildProductPayload(input: CreateProductInput, itemId?: string): string {
  const attributesXml = Object.entries(input.attributes)
    .filter(([key]) => !RESERVED_ATTRIBUTE_KEYS.has(key))
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join("");

  const skusXml = input.skus
    .map((sku) => {
      const { SellerSku, price, quantity, Images, ...rest } = sku;
      const imagesXml = Images?.length
        ? `<Images>${Images.map((url) => `<Image>${escapeXml(url)}</Image>`).join("")}</Images>`
        : "";
      const restXml = Object.entries(rest)
        .map(([key, value]) =>
          Array.isArray(value) ? "" : `<${key}>${escapeXml(String(value ?? ""))}</${key}>`,
        )
        .join("");
      return `<Sku><SellerSku>${escapeXml(SellerSku)}</SellerSku><price>${price}</price><quantity>${quantity}</quantity>${restXml}${imagesXml}</Sku>`;
    })
    .join("");

  // Daraz rejects a product with no top-level Images ("Main image is
  // require") even when every Sku already carries its own Images list - the
  // product-level gallery is a separate required field, not implied by the
  // per-Sku ones.
  const productImagesXml = input.images.length
    ? `<Images>${input.images.map((url) => `<Image>${escapeXml(url)}</Image>`).join("")}</Images>`
    : "";

  return `<Request><Product>${itemId ? `<ItemId>${itemId}</ItemId>` : ""}<PrimaryCategory>${input.primaryCategoryId}</PrimaryCategory><Attributes>${attributesXml}<name>${escapeXml(input.name)}</name><description>${escapeXml(input.description)}</description>${input.brandName ? `<brand>${escapeXml(input.brandName)}</brand>` : ""}</Attributes>${productImagesXml}<Skus>${skusXml}</Skus></Product></Request>`;
}
