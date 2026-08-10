export const DARAZ_SITES = {
  PK: { label: "Pakistan", host: "https://api.daraz.pk", storefrontHost: "https://www.daraz.pk", currency: "PKR" },
  BD: { label: "Bangladesh", host: "https://api.daraz.com.bd", storefrontHost: "https://www.daraz.com.bd", currency: "BDT" },
  LK: { label: "Sri Lanka", host: "https://api.daraz.lk", storefrontHost: "https://www.daraz.lk", currency: "LKR" },
  NP: { label: "Nepal", host: "https://api.daraz.com.np", storefrontHost: "https://www.daraz.com.np", currency: "NPR" },
  MM: { label: "Myanmar", host: "https://api.shop.com.mm", storefrontHost: "https://www.shop.com.mm", currency: "MMK" },
} as const;

export type DarazCountry = keyof typeof DARAZ_SITES;

export function isDarazCountry(value: string): value is DarazCountry {
  return value in DARAZ_SITES;
}

// Lazada/Daraz (same IOP-based marketplace family) resolve a bare item-id
// URL like this to the product's full SEO-slug page - no need to know the
// slug itself to link to a live listing.
export function darazProductUrl(country: string, itemId: string): string | null {
  if (!isDarazCountry(country)) return null;
  return `${DARAZ_SITES[country].storefrontHost}/products/i${itemId}.html`;
}
