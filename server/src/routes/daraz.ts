import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { requireAuth, requireStore, canManageStore } from "../authMiddleware.js";
import { createState, verifyState } from "../daraz/state.js";
import { getAuthorizeUrl, exchangeCodeForToken, getCategoryTree } from "../daraz/client.js";
import { encrypt } from "../daraz/crypto.js";
import { getValidAccessToken } from "../daraz/tokens.js";
import { isDarazCountry, DARAZ_SITES } from "../daraz/countries.js";
import { storesCol, type StoreDoc } from "../daraz/models.js";

const router = Router();

// Status reflects the *current* store (from session) - not behind
// requireStore, since "no store selected yet" is a valid, common state
// (first login, or right after disconnecting the current store) and should
// render as "not connected" rather than a 400.
router.get("/status", requireAuth, async (req, res) => {
  const storeId = req.session?.currentStoreId;
  if (!storeId) {
    res.json({ connected: false });
    return;
  }
  const snap = await storesCol.doc(storeId).get();
  if (!snap.exists) {
    res.json({ connected: false });
    return;
  }
  const store = snap.data() as StoreDoc;
  res.json({
    connected: true,
    storeId,
    name: store.name,
    country: store.country,
    countryLabel: isDarazCountry(store.country) ? DARAZ_SITES[store.country].label : store.country,
    sellerId: store.sellerId,
    connectedAt: store.connectedAt.toDate().toISOString(),
  });
});

// Starts the OAuth flow for a brand-new store - returns the Daraz authorize
// URL for the browser to navigate to (top-level navigation; Daraz's login
// page can't be embedded).
router.post("/connect", requireAuth, async (req, res) => {
  const { country } = req.body as { country?: string };
  if (!country || !isDarazCountry(country)) {
    res.status(400).json({ error: "Choose a valid Daraz country/site" });
    return;
  }
  if (req.session?.role === "customer") {
    const owned = await storesCol.where("ownerUserId", "==", req.session.userId).limit(1).get();
    if (!owned.empty) {
      res.status(400).json({ error: "You already have a connected store - use Reconnect instead." });
      return;
    }
  }
  const state = createState(country);
  res.json({ authorizeUrl: getAuthorizeUrl(state, country) });
});

// Same OAuth flow, but for refreshing an existing store's token (e.g. after
// its refresh token expired) - the state carries the store id through so the
// callback updates that store instead of creating a new one.
router.post("/:id/reconnect", requireAuth, async (req, res) => {
  const snap = await storesCol.doc(req.params.id).get();
  if (!snap.exists) {
    res.status(404).json({ error: "Store not found" });
    return;
  }
  const store = snap.data() as StoreDoc;
  if (!canManageStore(req, store.ownerUserId)) {
    res.status(403).json({ error: "Not authorized to reconnect this store" });
    return;
  }
  const state = createState(store.country, req.params.id);
  res.json({ authorizeUrl: getAuthorizeUrl(state, store.country) });
});

// Daraz redirects here as a plain top-level browser navigation after login -
// no session/cookie context from the app is available, hence the signed
// `state` param carrying the country (and optional storeId) through.
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
    const tokenFields = {
      country: verified.country,
      sellerId,
      accessTokenEnc: encrypt(token.access_token),
      refreshTokenEnc: encrypt(token.refresh_token),
      tokenExpiresAt: Timestamp.fromMillis(Date.now() + token.expires_in * 1000),
      refreshTokenExpiresAt: Timestamp.fromMillis(Date.now() + token.refresh_expires_in * 1000),
      updatedAt: now,
    };

    let storeId: string;
    if (verified.storeId) {
      const ref = storesCol.doc(verified.storeId);
      const existing = await ref.get();
      if (!existing.exists) throw new Error("Store no longer exists");
      // Defense in depth: the signed state is only ever issued after the
      // /:id/reconnect ownership check, but re-verify here too since this
      // callback is the one place that actually writes the new tokens.
      if (!canManageStore(req, (existing.data() as StoreDoc).ownerUserId)) {
        throw new Error("Not authorized to reconnect this store");
      }
      await ref.update(tokenFields);
      storeId = verified.storeId;
    } else {
      const countryLabel = isDarazCountry(verified.country)
        ? DARAZ_SITES[verified.country].label
        : verified.country;
      const data: StoreDoc = {
        ...tokenFields,
        name: `${countryLabel} Store`,
        ownerUserId: req.session?.role === "customer" ? req.session.userId ?? null : null,
        createdAt: now,
        connectedAt: now,
      };
      const ref = await storesCol.add(data);
      storeId = ref.id;
    }

    if (req.session) req.session.currentStoreId = storeId;

    // CLIENT_URL is unset in some deployments (e.g. client+server sharing
    // one Vercel domain) - falling back to "" makes this an absolute-path
    // redirect (same origin) instead of a broken relative one (an unset env
    // var would otherwise literally interpolate as the string "undefined").
    const clientUrl = process.env.CLIENT_URL ?? "";
    res.redirect(`${clientUrl}/daraz?connected=1`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const clientUrl = process.env.CLIENT_URL ?? "";
    res.redirect(`${clientUrl}/daraz?error=${encodeURIComponent(message)}`);
  }
});

router.post("/test-connection", requireAuth, requireStore, async (req, res) => {
  try {
    const session = await getValidAccessToken(req.session!.currentStoreId!);
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

router.get("/categories", requireAuth, requireStore, async (req, res) => {
  try {
    const session = await getValidAccessToken(req.session!.currentStoreId!);
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
