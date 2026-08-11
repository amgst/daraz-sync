import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getValidAccessToken } from "./tokens.js";
import { getOrders, getOrderItems } from "./client.js";
import { ordersCol, type OrderDoc, type OrderItemDoc } from "./models.js";

export interface ImportOrdersResult {
  imported: number;
  updated: number;
}

// Pulls orders from Daraz into this app's own DB for viewing - read-only,
// nothing is pushed anywhere else from here. Doc id = `${storeId}_${darazOrderId}`,
// so this is a plain upsert-by-id.
export async function importDarazOrders(storeId: string): Promise<ImportOrdersResult> {
  const darazSession = await getValidAccessToken(storeId);
  if (!darazSession) {
    throw new Error("No connected Daraz account");
  }
  const darazOpts = {
    accessToken: darazSession.accessToken,
    country: darazSession.country,
  };

  const orders = await getOrders(darazOpts);

  let imported = 0;
  let updated = 0;

  for (const order of orders) {
    const items = await getOrderItems(darazOpts, order.orderId);
    const docRef = ordersCol.doc(`${storeId}_${order.orderId}`);
    const existing = await docRef.get();
    const now = Timestamp.now();

    const itemDocs: OrderItemDoc[] = items.map((item) => ({
      id: randomUUID(),
      darazOrderItemId: item.orderItemId,
      sku: item.sku ?? null,
      name: item.name ?? null,
      imageUrl: item.imageUrl ?? null,
      price: item.price ?? null,
      currency: item.currency ?? null,
      status: item.status ?? null,
    }));

    const fields = {
      storeId,
      darazOrderId: order.orderId,
      orderNumber: order.orderNumber ?? null,
      customerName: order.customerName ?? null,
      status: order.status,
      itemsCount: order.itemsCount,
      totalAmount: order.totalAmount ?? null,
      currency: order.currency ?? null,
      darazCreatedAt: order.createdAt ? Timestamp.fromDate(new Date(order.createdAt)) : null,
      darazUpdatedAt: order.updatedAt ? Timestamp.fromDate(new Date(order.updatedAt)) : null,
      items: itemDocs,
      updatedAt: now,
    };

    if (existing.exists) {
      await docRef.update(fields);
      updated++;
    } else {
      const data: OrderDoc = { ...fields, importedAt: now };
      await docRef.set(data);
      imported++;
    }
  }

  return { imported, updated };
}
