import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Product } from "../api";
import { useToast } from "../ToastContext";

export default function Products() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [pulling, setPulling] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useToast();

  const load = () => api.get<{ products: Product[] }>("/products").then((r) => setProducts(r.products));

  const deleteProduct = async (p: Product) => {
    const warning = p.darazItemId
      ? `"${p.title}" is linked to Daraz item ${p.darazItemId}. Deleting only removes it from this app's tracking - it will NOT delete or unlist the product on Daraz itself. Continue?`
      : `Delete "${p.title}"? This only removes it from this app - it was never synced to Daraz.`;
    if (!window.confirm(warning)) return;
    setDeletingId(p.id);
    try {
      await api.delete(`/products/${p.id}`);
      setProducts((prev) => prev?.filter((x) => x.id !== p.id) ?? null);
      toast.show("Product removed");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Delete failed", { isError: true });
    } finally {
      setDeletingId(null);
    }
  };

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

  const importAllFromDaraz = async () => {
    setImportingAll(true);
    try {
      const result = await api.post<{ imported: number; skipped: number; errors: string[] }>(
        "/products/import-all",
      );
      toast.show(
        `Imported ${result.imported} product(s) from Daraz, skipped ${result.skipped} already linked` +
          (result.errors.length ? ` (${result.errors.length} failed)` : ""),
        { isError: result.errors.length > 0 },
      );
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Import failed", { isError: true });
    } finally {
      setImportingAll(false);
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
            Already have products listed on Daraz? Import your whole catalog as local products in
            one go - already-linked products are skipped, so this is safe to re-run.
          </p>
          <button onClick={importAllFromDaraz} disabled={importingAll}>
            {importingAll ? "Importing..." : "Import all from Daraz"}
          </button>
        </div>
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
                  <button className="critical" onClick={() => deleteProduct(p)} disabled={deletingId === p.id}>
                    {deletingId === p.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
