import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DarazOrder } from "../api";
import { useToast } from "../ToastContext";

const STATUS_CLASS: Record<string, string> = {
  delivered: "synced",
  shipped: "pending",
  pending: "unmapped",
  canceled: "error",
  cancelled: "error",
  returned: "error",
};

export default function Orders() {
  const [orders, setOrders] = useState<DarazOrder[] | null>(null);
  const [importing, setImporting] = useState(false);
  const toast = useToast();

  const load = () =>
    api
      .get<{ orders: DarazOrder[] }>("/orders")
      .then((r) => setOrders(r.orders))
      .catch((err) => {
        toast.show(err instanceof Error ? err.message : "Failed to load orders", { isError: true });
        setOrders([]);
      });

  useEffect(() => {
    load();
  }, []);

  const importOrders = async () => {
    setImporting(true);
    try {
      const result = await api.post<{ imported: number; updated: number }>("/orders/import");
      toast.show(`Synced orders: ${result.imported} new, ${result.updated} updated`);
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Order sync failed", { isError: true });
    } finally {
      setImporting(false);
    }
  };

  if (!orders) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
        </div>
        <button className="primary" onClick={importOrders} disabled={importing}>
          {importing ? "Syncing..." : "Sync orders"}
        </button>
      </div>

      <div className="card">
        {orders.length === 0 ? (
          <p className="subdued">No orders imported yet. Click "Sync orders" to pull from Daraz.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Items</th>
                <th>Total</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/orders/${o.id}`}>{o.orderNumber ?? o.darazOrderId}</Link>
                  </td>
                  <td>{o.customerName ?? "Unknown"}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[o.status.toLowerCase()] ?? "pending"}`}>{o.status}</span>
                  </td>
                  <td>{o.itemsCount}</td>
                  <td>
                    {o.totalAmount ?? "-"} {o.currency ?? ""}
                  </td>
                  <td>{o.darazCreatedAt ? new Date(o.darazCreatedAt).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
