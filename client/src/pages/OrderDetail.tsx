import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type DarazOrder } from "../api";

export default function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState<DarazOrder | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ order: DarazOrder }>(`/orders/${id}`)
      .then((r) => setOrder(r.order))
      .catch(() => setOrder(null));
  }, [id]);

  if (order === undefined) return null;

  if (order === null) {
    return (
      <>
        <div className="page-header">
          <h1>Order not found</h1>
        </div>
        <Link to="/orders">
          <button>Back to orders</button>
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Order {order.orderNumber ?? order.darazOrderId}</h1>
        </div>
        <Link to="/orders">
          <button>Back to orders</button>
        </Link>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 32 }}>
          <div>
            <div className="subdued small">Customer</div>
            <div>{order.customerName ?? "Unknown"}</div>
          </div>
          <div>
            <div className="subdued small">Total</div>
            <div>
              {order.totalAmount ?? "-"} {order.currency ?? ""}
            </div>
          </div>
          <div>
            <div className="subdued small">Daraz order ID</div>
            <div>{order.darazOrderId}</div>
          </div>
          <div>
            <div className="subdued small">Order date</div>
            <div>{order.darazCreatedAt ? new Date(order.darazCreatedAt).toLocaleString() : "-"}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Items</h2>
        {order.items.map((item) => (
          <div className="list-item" key={item.id}>
            <img src={item.imageUrl ?? ""} alt="" />
            <div className="grow">
              <div className="title">{item.name ?? "Unnamed item"}</div>
              <div className="meta">
                {item.sku ?? "No SKU"}
                {item.status ? ` - ${item.status}` : ""}
              </div>
            </div>
            <div>
              {item.price ?? "-"} {item.currency ?? ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
