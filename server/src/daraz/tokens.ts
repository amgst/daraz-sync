import { Timestamp } from "firebase-admin/firestore";
import { decrypt, encrypt } from "./crypto.js";
import { refreshAccessToken } from "./client.js";
import { storesCol, type StoreDoc } from "./models.js";

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export interface DarazSession {
  accessToken: string;
  country: string;
  sellerId: string | null;
}

// Returns a usable Daraz access token for the given store, transparently
// refreshing (and re-persisting, re-encrypted) it if it's within 5 minutes
// of expiry.
export async function getValidAccessToken(storeId: string): Promise<DarazSession | null> {
  const ref = storesCol.doc(storeId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const store = snap.data() as StoreDoc;

  if (store.tokenExpiresAt.toMillis() - Date.now() > REFRESH_MARGIN_MS) {
    return {
      accessToken: decrypt(store.accessTokenEnc),
      country: store.country,
      sellerId: store.sellerId,
    };
  }

  if (store.refreshTokenExpiresAt.toMillis() <= Date.now()) {
    throw new Error("Daraz refresh token expired - reconnect this store");
  }

  const refreshToken = decrypt(store.refreshTokenEnc);
  const refreshed = await refreshAccessToken(refreshToken, store.country);

  await ref.update({
    accessTokenEnc: encrypt(refreshed.access_token),
    refreshTokenEnc: encrypt(refreshed.refresh_token),
    tokenExpiresAt: Timestamp.fromMillis(Date.now() + refreshed.expires_in * 1000),
    refreshTokenExpiresAt: Timestamp.fromMillis(Date.now() + refreshed.refresh_expires_in * 1000),
    updatedAt: Timestamp.now(),
  });

  return {
    accessToken: refreshed.access_token,
    country: store.country,
    sellerId: store.sellerId,
  };
}
