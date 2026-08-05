// Vercel serverless function entry point. Requires `npm run build` to have
// already compiled server/src -> server/dist (the configured buildCommand
// in vercel.json does this before functions are bundled). All /api/* traffic
// is rewritten to this single function (see vercel.json), and the Express
// app inside handles its own sub-routing.
import app from "../server/dist/app.js";

export default app;
