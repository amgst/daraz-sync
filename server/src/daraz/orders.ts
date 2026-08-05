import db from "../db.js";
import { getValidAccessToken } from "./tokens.js";
import { getOrders, getOrderItems } from "./client.js";

export interface ImportOrdersResult {
  imported: number;
  updated: number;
}

// Pulls orders from Daraz into this app's own DB for viewing - read-only,
// nothing is pushed anywhere else from here.
export async function importDarazOrders(): Promise<ImportOrdersResult> {
  const darazSession = await getValidAccessToken();
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

    const existing = await db.darazOrder.findUnique({
      where: { darazOrderId: order.orderId },
    });

    const data = {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      status: order.status,
      itemsCount: order.itemsCount,
      totalAmount: order.totalAmount,
      currency: order.currency,
      darazCreatedAt: order.createdAt ? new Date(order.createdAt) : null,
      darazUpdatedAt: order.updatedAt ? new Date(order.updatedAt) : null,
    };

    if (existing) {
      await db.darazOrderItem.deleteMany({ where: { orderId: existing.id } });
      await db.darazOrder.update({
        where: { id: existing.id },
        data: {
          ...data,
          items: {
            create: items.map((item) => ({
              darazOrderItemId: item.orderItemId,
              sku: item.sku,
              name: item.name,
              imageUrl: item.imageUrl,
              price: item.price,
              currency: item.currency,
              status: item.status,
            })),
          },
        },
      });
      updated++;
    } else {
      await db.darazOrder.create({
        data: {
          darazOrderId: order.orderId,
          ...data,
          items: {
            create: items.map((item) => ({
              darazOrderItemId: item.orderItemId,
              sku: item.sku,
              name: item.name,
              imageUrl: item.imageUrl,
              price: item.price,
              currency: item.currency,
              status: item.status,
            })),
          },
        },
      });
      imported++;
    }
  }

  return { imported, updated };
}
