# daraz-sync

Standalone web app for managing a product catalog and publishing/syncing it to Daraz — no Shopify involved.

## Stack

- **Server**: Node + Express + TypeScript, Prisma + SQLite (`server/`)
- **Client**: React + Vite + TypeScript (`client/`)

## Development

```bash
npm install
cp server/.env.example server/.env   # fill in DARAZ_APP_KEY/SECRET, generate the secrets listed
cd server && npx prisma migrate dev --name init && cd ..
npm run dev
```

Server runs on `http://localhost:3001`, client on `http://localhost:5173` (proxies `/api` to the server).

## Daraz OAuth

The redirect/callback URL (`DARAZ_REDIRECT_URI` in `server/.env`) must exactly match the callback URL registered for this app at [open.daraz.com](https://open.daraz.com) — Daraz does not accept `http://localhost` there, so OAuth connect only works once this app is deployed somewhere with a real HTTPS domain.

## Deploy

Build both packages and run the server (which also serves the built client in production):

```bash
npm run build
npm start
```

Requires a persistent disk for the SQLite database file (`server/prisma/dev.db`) to survive restarts/redeploys.
