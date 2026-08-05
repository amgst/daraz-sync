import db from "../db.js";
import { decrypt, encrypt } from "./crypto.js";
import { refreshAccessToken } from "./client.js";

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export interface DarazSession {
  accessToken: string;
  country: string;
  sellerId: string | null;
}

// Returns a usable Daraz access token, transparently refreshing (and
// re-persisting, re-encrypted) it if it's within 5 minutes of expiry.
export async function getValidAccessToken(): Promise<DarazSession | null> {
  const account = await db.darazAccount.findUnique({ where: { id: "singleton" } });
  if (!account) return null;

  if (account.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return {
      accessToken: decrypt(account.accessTokenEnc),
      country: account.country,
      sellerId: account.sellerId,
    };
  }

  if (account.refreshTokenExpiresAt.getTime() <= Date.now()) {
    throw new Error("Daraz refresh token expired - reconnect your Daraz account");
  }

  const refreshToken = decrypt(account.refreshTokenEnc);
  const refreshed = await refreshAccessToken(refreshToken, account.country);

  await db.darazAccount.update({
    where: { id: "singleton" },
    data: {
      accessTokenEnc: encrypt(refreshed.access_token),
      refreshTokenEnc: encrypt(refreshed.refresh_token),
      tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      refreshTokenExpiresAt: new Date(
        Date.now() + refreshed.refresh_expires_in * 1000,
      ),
    },
  });

  return {
    accessToken: refreshed.access_token,
    country: account.country,
    sellerId: account.sellerId,
  };
}
