import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { requireAuth } from "../authMiddleware.js";
import { createState, verifyState } from "../daraz/state.js";
import { getAuthorizeUrl, exchangeCodeForToken, getCategoryTree } from "../daraz/client.js";
import { encrypt } from "../daraz/crypto.js";
import { getValidAccessToken } from "../daraz/tokens.js";
import { isDarazCountry, DARAZ_SITES } from "../daraz/countries.js";
import { accountRef, type DarazAccountDoc } from "../daraz/models.js";

const router = Router();

router.get("/status", requireAuth, async (_req, res) => {
  const snap = await accountRef.get();
  if (!snap.exists) {
    res.json({ connected: false });
    return;
  }
  const account = snap.data() as DarazAccountDoc;
  res.json({
    connected: true,
    country: account.country,
    countryLabel: isDarazCountry(account.country) ? DARAZ_SITES[account.country].label : account.country,
    sellerId: account.sellerId,
    connectedAt: account.connectedAt.toDate().toISOString(),
  });
});

// Starts the OAuth flow - returns the Daraz authorize URL for the browser to
// navigate to (top-level navigation; Daraz's login page can't be embedded).
router.post("/connect", requireAuth, (req, res) => {
  const { country } = req.body as { country?: string };
  if (!country || !isDarazCountry(country)) {
    res.status(400).json({ error: "Choose a valid Daraz country/site" });
    return;
  }
  const state = createState(country);
  res.json({ authorizeUrl: getAuthorizeUrl(state, country) });
});

// Daraz redirects here as a plain top-level browser navigation after login -
// no session/cookie context from the app is available, hence the signed
// `state` param carrying the country through.
router.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state) {
    res.status(400).send("Missing code or state");
    return;
  }

  const verified = verifyState(state);
  if (!verified) {
    res.status(400).send("Invalid or expired state parameter");
    return;
  }

  try {
    const token = await exchangeCodeForToken(code, verified.country);
    const sellerId = token.country_user_info?.[0]?.seller_id ?? null;
    const now = Timestamp.now();

    const existing = await accountRef.get();
    const data: DarazAccountDoc = {
      country: verified.country,
      sellerId,
      accessTokenEnc: encrypt(token.access_token),
      refreshTokenEnc: encrypt(token.refresh_token),
      tokenExpiresAt: Timestamp.fromMillis(Date.now() + token.expires_in * 1000),
      refreshTokenExpiresAt: Timestamp.fromMillis(Date.now() + token.refresh_expires_in * 1000),
      connectedAt: existing.exists ? (existing.data() as DarazAccountDoc).connectedAt : now,
      updatedAt: now,
    };
    await accountRef.set(data);

    res.redirect(`${process.env.CLIENT_URL}/daraz?connected=1`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.redirect(`${process.env.CLIENT_URL}/daraz?error=${encodeURIComponent(message)}`);
  }
});

router.post("/disconnect", requireAuth, async (_req, res) => {
  await accountRef.delete();
  res.json({ ok: true });
});

router.post("/test-connection", requireAuth, async (_req, res) => {
  try {
    const session = await getValidAccessToken();
    if (!session) {
      res.json({ ok: false, message: "Not connected to Daraz" });
      return;
    }
    const categories = await getCategoryTree({
      accessToken: session.accessToken,
      country: session.country,
    });
    res.json({
      ok: true,
      message: `Connected - fetched ${categories.length} top-level categories from Daraz`,
    });
  } catch (error) {
    res.json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/categories", requireAuth, async (_req, res) => {
  try {
    const session = await getValidAccessToken();
    if (!session) {
      res.status(400).json({ error: "Not connected to Daraz" });
      return;
    }
    const categoryTree = await getCategoryTree({
      accessToken: session.accessToken,
      country: session.country,
    });
    res.json({ categoryTree });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
