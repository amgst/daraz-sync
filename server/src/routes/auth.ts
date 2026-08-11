import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { usersCol, findUserByEmail, type UserDoc } from "../auth/users.js";
import { storesCol } from "../daraz/models.js";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/signup", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    res.status(400).json({ error: "An account with that email already exists" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const data: UserDoc = { email: normalizedEmail, passwordHash, createdAt: Timestamp.now() };
  const ref = await usersCol.add(data);

  if (req.session) {
    req.session.role = "customer";
    req.session.userId = ref.id;
  }
  res.json({ ok: true, role: "customer" });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  if (username === process.env.APP_USERNAME && password === process.env.APP_PASSWORD) {
    if (req.session) {
      req.session.role = "admin";
      delete req.session.userId;
      // Default to the earliest-connected store so the admin isn't dropped
      // into a dead "no store selected" state on first login - they can
      // still switch afterward.
      if (!req.session.currentStoreId) {
        const firstStore = await storesCol.orderBy("createdAt", "asc").limit(1).get();
        if (!firstStore.empty) req.session.currentStoreId = firstStore.docs[0].id;
      }
    }
    res.json({ ok: true, role: "admin" });
    return;
  }

  const user = await findUserByEmail(username);
  if (!user || !(await verifyPassword(password, user.data.passwordHash))) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  if (req.session) {
    req.session.role = "customer";
    req.session.userId = user.id;
    const owned = await storesCol.where("ownerUserId", "==", user.id).limit(1).get();
    if (!owned.empty) req.session.currentStoreId = owned.docs[0].id;
    else delete req.session.currentStoreId;
  }
  res.json({ ok: true, role: "customer" });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get("/status", (req, res) => {
  const role = req.session?.role ?? null;
  res.json({ loggedIn: Boolean(role), role });
});

export default router;
