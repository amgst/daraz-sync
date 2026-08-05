import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieSession from "cookie-session";

import authRoutes from "./routes/auth.js";
import darazRoutes from "./routes/daraz.js";
import productsRoutes from "./routes/products.js";
import ordersRoutes from "./routes/orders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

for (const required of ["SESSION_SECRET", "STATE_SECRET", "ENCRYPTION_KEY", "APP_USERNAME", "APP_PASSWORD"]) {
  if (!process.env[required]) {
    console.warn(`[daraz-sync] Warning: ${required} is not set - see server/.env.example`);
  }
}

const app = express();
const isProduction = process.env.NODE_ENV === "production";

app.use(
  cors({
    origin: isProduction ? true : process.env.CLIENT_URL,
    credentials: true,
  }),
);
app.use(express.json());
app.use(
  cookieSession({
    name: "daraz_sync_session",
    secret: process.env.SESSION_SECRET ?? "dev-only-insecure-secret",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: "lax",
    secure: isProduction,
  }),
);

app.use("/api/auth", authRoutes);
app.use("/api/daraz", darazRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoutes);

if (isProduction) {
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`[daraz-sync] server listening on http://localhost:${port}`);
});
