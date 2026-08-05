# daraz-sync

Standalone web app for managing a product catalog and publishing/syncing it to Daraz — no Shopify involved.

## Stack

- **Server**: Node + Express + TypeScript, Firebase Admin SDK + Firestore (`server/`)
- **Client**: React + Vite + TypeScript (`client/`)

## Development

```bash
npm install
cp server/.env.example server/.env   # fill in DARAZ_APP_KEY/SECRET, FIREBASE_*, generate the secrets listed
npm run dev
```

Server runs on `http://localhost:3001`, client on `http://localhost:5173` (proxies `/api` to the server).

## Daraz OAuth

The redirect/callback URL (`DARAZ_REDIRECT_URI` in `server/.env`) must exactly match the callback URL registered for this app at [open.daraz.com](https://open.daraz.com) — Daraz does not accept `http://localhost` there, so OAuth connect only works once this app is deployed somewhere with a real HTTPS domain.

## Deploy

### Vercel

`vercel.json` at the repo root wires this up as a single Vercel project: `buildCommand` builds both packages, static assets are served from `client/dist`, and `api/index.mjs` exposes the compiled Express app (`server/dist/app.js`) as one serverless function that all `/api/*` requests get rewritten to.

Set these in the Vercel project's environment variables (see `server/.env.example` for the full list): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `DARAZ_APP_KEY`, `DARAZ_APP_SECRET`, `DARAZ_REDIRECT_URI` (must point at `https://<your-domain>/api/daraz/callback`, and be registered as such at open.daraz.com), `ENCRYPTION_KEY`, `STATE_SECRET`, `SESSION_SECRET`, `CRON_SECRET`, `APP_USERNAME`, `APP_PASSWORD`, `NODE_ENV=production`.

#### Scheduled auto-sync

`vercel.json` also registers a cron job (`crons`) that hits `GET /api/cron/sync` once a day, which imports new/updated Daraz orders and pulls price/stock changes for already-linked products - the same two actions as the manual "Sync orders" / "Check Daraz for updates" buttons. Vercel authenticates its own cron calls automatically by sending `Authorization: Bearer <CRON_SECRET>`, matched against the `CRON_SECRET` env var.

Vercel's **Hobby plan caps cron jobs at once per day**; the default schedule (`0 3 * * *`, 3am UTC) reflects that. On Pro, edit the `schedule` in `vercel.json` to run more often (e.g. `0 */6 * * *` for every 6 hours).

### Persistent-process hosts (Railway, Render, a VPS)

Build both packages and run the server (which also serves the built client in production):

```bash
npm run build
npm start
```

Data lives in Firestore, so no persistent disk is needed either way.
