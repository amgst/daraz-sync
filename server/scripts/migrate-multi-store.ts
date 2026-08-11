// One-off migration: converts the old single-store data model (a singleton
// `darazAccounts/singleton` doc, plus unscoped `products`/`darazOrders`
// collections) into the new multi-store model (a `stores` collection, with
// every product/order tagged by `storeId`).
//
// Run manually once, e.g.:
//   cd server && npx tsx scripts/migrate-multi-store.ts --name "Main Store"
//
// Safe to re-run: if `darazAccounts/singleton` no longer exists (already
// migrated), it's a no-op.
import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import db from "../src/db.js";
import type { StoreDoc } from "../src/daraz/models.js";

async function main() {
  const nameArgIndex = process.argv.indexOf("--name");
  const storeName = nameArgIndex !== -1 ? process.argv[nameArgIndex + 1] : "Store 1";

  const singletonRef = db.collection("darazAccounts").doc("singleton");
  const singletonSnap = await singletonRef.get();

  if (!singletonSnap.exists) {
    console.log("No darazAccounts/singleton doc found - nothing to migrate.");
    return;
  }

  const account = singletonSnap.data() as Omit<StoreDoc, "name" | "createdAt">;
  const now = Timestamp.now();
  const storeData: StoreDoc = {
    ...account,
    name: storeName,
    createdAt: account.connectedAt ?? now,
  };

  const storeRef = await db.collection("stores").add(storeData);
  console.log(`Created stores/${storeRef.id} ("${storeName}") from the old singleton account.`);

  for (const collectionName of ["products", "darazOrders"]) {
    const snap = await db.collection(collectionName).get();
    if (snap.empty) {
      console.log(`No docs in "${collectionName}" to tag.`);
      continue;
    }
    let batch = db.batch();
    let opsInBatch = 0;
    let total = 0;
    for (const doc of snap.docs) {
      batch.update(doc.ref, { storeId: storeRef.id });
      opsInBatch++;
      total++;
      if (opsInBatch === 400) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }
    if (opsInBatch > 0) await batch.commit();
    console.log(`Tagged ${total} doc(s) in "${collectionName}" with storeId=${storeRef.id}.`);
  }

  await singletonRef.delete();
  console.log("Deleted darazAccounts/singleton.");
  console.log(
    "\nDone. If you were actually using a second Daraz store, its OAuth connection was\n" +
      "overwritten by this one and no longer exists - reconnect it fresh via 'Add store'\n" +
      "in the app's Stores admin page once this migration is deployed.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
