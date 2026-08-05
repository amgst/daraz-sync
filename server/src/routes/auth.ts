import { Router } from "express";

const router = Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (
    username === process.env.APP_USERNAME &&
    password === process.env.APP_PASSWORD &&
    username &&
    password
  ) {
    if (req.session) req.session.loggedIn = true;
    res.json({ ok: true });
    return;
  }

  res.status(401).json({ error: "Invalid username or password" });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get("/status", (req, res) => {
  res.json({ loggedIn: Boolean(req.session?.loggedIn) });
});

export default router;
