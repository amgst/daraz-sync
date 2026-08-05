// Daraz Open Platform runs one API gateway host per country site - both the
// REST API (under /rest) and the OAuth authorize/login page (under /oauth)
// live on that same host. The country is chosen up front (there's only one
// Daraz account for this app) and travels through the signed `state` param
// so the callback knows which host to exchange the code against.
import { DARAZ_SITES, isDarazCountry } from "./countries.js";

function hostFor(country: string): string {
  if (!isDarazCountry(country)) {
    throw new Error(`Unknown Daraz country/site: ${country}`);
  }
  return DARAZ_SITES[country].host;
}

export function apiHostFor(country: string): string {
  return `${hostFor(country)}/rest`;
}

export function oauthHostFor(country: string): string {
  return hostFor(country);
}

export function getDarazAppCredentials() {
  const appKey = process.env.DARAZ_APP_KEY;
  const appSecret = process.env.DARAZ_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error(
      "DARAZ_APP_KEY / DARAZ_APP_SECRET environment variables are not set",
    );
  }
  return { appKey, appSecret };
}

export function getDarazRedirectUri(): string {
  const redirectUri = process.env.DARAZ_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("DARAZ_REDIRECT_URI environment variable is not set");
  }
  return redirectUri;
}
