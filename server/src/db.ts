import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin credentials for server-side access to Firestore (Supabase's
// replacement). FIREBASE_PRIVATE_KEY is stored with literal "\n" sequences
// in env vars (Vercel, .env files), so they need converting to real newlines.
function initFirebase() {
  if (getApps().length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY environment variables are not set",
    );
  }

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

initFirebase();

const db = getFirestore();

export default db;
