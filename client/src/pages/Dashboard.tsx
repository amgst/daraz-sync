import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Product, type DarazOrder } from "../api";

export default function Dashboard() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [orders, setOrders] = useState<DarazOrder[] | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    api.get<{ products: Product[] }>("/products").then((r) => setProducts(r.products));
    api.get<{ orders: DarazOrder[] }>("/orders").then((r) => setOrders(r.orders));
    api.get<{ connected: boolean }>("/daraz/status").then((r) => setConnected(r.connected));
  }, []);

  if (connected === false) {
    return (
      <>
        <div className="page-header">
          <h1>Dashboard</h1>
        </div>
        <div className="card">
          <h2>Connect your Daraz seller account to get started</h2>
          <p className="subdued">
            Once connected, you can create products here and publish them to Daraz, keep price and
            stock in sync, and see Daraz orders in one place.
          </p>
          <Link to="/daraz">
            <button className="primary">Connect Daraz</button>
          </Link>
        </div>
      </>
    );
  }

  const counts = (products ?? []).reduce(
    (acc, p) => {
      acc[p.syncStatus] = (acc[p.syncStatus] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="card" style={{ flex: 1 }}>
          <h2>Products</h2>
          <div className="stack gap-4">
            <div className="row between">
              <span>Synced</span>
              <span className="badge synced">{counts.synced ?? 0}</span>
            </div>
            <div className="row between">
              <span>Pending</span>
              <span className="badge pending">{counts.pending ?? 0}</span>
            </div>
            <div className="row between">
              <span>Unmapped</span>
              <span className="badge unmapped">{counts.unmapped ?? 0}</span>
            </div>
            <div className="row between">
              <span>Errors</span>
              <span className="badge error">{counts.error ?? 0}</span>
            </div>
          </div>
          <div className="divider" />
          <Link to="/products">
            <button>Go to products</button>
          </Link>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h2>Orders</h2>
          <p style={{ fontSize: 28, fontWeight: 700, margin: "4px 0" }}>{orders?.length ?? 0}</p>
          <p className="subdued small">Orders imported from Daraz</p>
          <div className="divider" />
          <Link to="/orders">
            <button>Go to orders</button>
          </Link>
        </div>
      </div>
    </>
  );
}
