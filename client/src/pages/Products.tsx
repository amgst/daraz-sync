import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Product } from "../api";
import { useToast } from "../ToastContext";

export default function Products() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [pulling, setPulling] = useState(false);
  const toast = useToast();

  const load = () => api.get<{ products: Product[] }>("/products").then((r) => setProducts(r.products));

  useEffect(() => {
    load();
  }, []);

  const pullFromDaraz = async () => {
    setPulling(true);
    try {
      const result = await api.post<{ productsChecked: number; productsUpdated: number; errors: string[] }>(
        "/products/pull-from-daraz",
      );
      toast.show(
        `Checked ${result.productsChecked} product(s) on Daraz, updated ${result.productsUpdated} with new price/stock`,
        { isError: result.errors.length > 0 },
      );
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Failed to check Daraz", { isError: true });
    } finally {
      setPulling(false);
    }
  };

  if (!products) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Products</h1>
        </div>
        <Link to="/products/new">
          <button className="primary">New product</button>
        </Link>
      </div>

      <div className="card">
        <div className="row between">
          <p style={{ margin: 0 }}>
            Price and stock are owned by Daraz once synced - check for changes made directly in
            Daraz's seller center and pull them in.
          </p>
          <button onClick={pullFromDaraz} disabled={pulling}>
            {pulling ? "Checking..." : "Check Daraz for updates"}
          </button>
        </div>
      </div>

      <div className="card">
        {products.length === 0 ? (
          <p className="subdued">No products yet. Create one to get started.</p>
        ) : (
          products.map((p) => {
            const images = JSON.parse(p.imagesJson) as string[];
            return (
              <div className="list-item" key={p.id}>
                <img src={images[0] ?? ""} alt="" />
                <div className="grow">
                  <div className="title">
                    <Link to={`/products/${p.id}`}>{p.title}</Link>
                  </div>
                  <div className="meta">
                    <span className={`badge ${p.syncStatus}`}>{p.syncStatus}</span>
                    {p.darazItemId ? ` Daraz item ${p.darazItemId}` : ""}
                  </div>
                </div>
                <div className="actions">
                  <Link to={`/products/${p.id}`}>
                    <button>{p.syncStatus === "unmapped" ? "Map category" : "Edit"}</button>
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
