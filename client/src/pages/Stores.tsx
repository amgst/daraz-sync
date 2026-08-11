import { useState } from "react";
import { api, type Store } from "../api";
import { useStores } from "../StoreContext";
import { useToast } from "../ToastContext";

const COUNTRY_OPTIONS = [
  { value: "PK", label: "Pakistan" },
  { value: "BD", label: "Bangladesh" },
  { value: "LK", label: "Sri Lanka" },
  { value: "NP", label: "Nepal" },
  { value: "MM", label: "Myanmar" },
];

export default function Stores() {
  const { stores, switchStore, refresh, loading } = useStores();
  const toast = useToast();
  const [country, setCountry] = useState("PK");
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const addStore = async () => {
    setAdding(true);
    try {
      const res = await api.post<{ authorizeUrl: string }>("/daraz/connect", { country });
      window.location.href = res.authorizeUrl;
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Failed to start connection", { isError: true });
      setAdding(false);
    }
  };

  const reconnect = async (store: Store) => {
    setBusyId(store.id);
    try {
      const res = await api.post<{ authorizeUrl: string }>(`/daraz/${store.id}/reconnect`);
      window.location.href = res.authorizeUrl;
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Failed to start reconnection", { isError: true });
      setBusyId(null);
    }
  };

  const startRename = (store: Store) => {
    setRenamingId(store.id);
    setRenameValue(store.name);
  };

  const saveRename = async (id: string) => {
    if (!renameValue.trim()) return;
    setBusyId(id);
    try {
      await api.put(`/stores/${id}`, { name: renameValue.trim() });
      setRenamingId(null);
      await refresh();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Failed to rename store", { isError: true });
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (store: Store) => {
    const warning =
      `Disconnect "${store.name}"? This removes its Daraz connection from this app. ` +
      `Its ${store.productCount} product(s) and ${store.orderCount} order(s) already synced here will stay in the database but won't be reachable until you reconnect a store for them.`;
    if (!window.confirm(warning)) return;
    setBusyId(store.id);
    try {
      await api.delete(`/stores/${store.id}`);
      toast.show(`Disconnected "${store.name}"`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Stores</h1>
          <div className="subtitle">All Daraz stores connected to this app</div>
        </div>
      </div>

      <div className="card">
        {stores.length === 0 ? (
          <p className="subdued">No stores connected yet - add one below.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Country</th>
                <th>Seller ID</th>
                <th>Connected</th>
                <th>Products</th>
                <th>Orders</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id}>
                  <td>
                    {renamingId === store.id ? (
                      <div className="row">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          style={{ width: 160 }}
                          autoFocus
                        />
                        <button onClick={() => saveRename(store.id)} disabled={busyId === store.id}>
                          Save
                        </button>
                        <button className="plain" onClick={() => setRenamingId(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        {store.name}
                        {store.isCurrent && <span className="badge synced" style={{ marginLeft: 8 }}>Current</span>}
                      </>
                    )}
                  </td>
                  <td>{store.countryLabel}</td>
                  <td>{store.sellerId ?? "—"}</td>
                  <td>{new Date(store.connectedAt).toLocaleDateString()}</td>
                  <td>{store.productCount}</td>
                  <td>{store.orderCount}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      {!store.isCurrent && (
                        <button onClick={() => switchStore(store.id)} disabled={busyId === store.id}>
                          Switch
                        </button>
                      )}
                      {renamingId !== store.id && (
                        <button className="plain" onClick={() => startRename(store)} disabled={busyId === store.id}>
                          Rename
                        </button>
                      )}
                      <button onClick={() => reconnect(store)} disabled={busyId === store.id}>
                        Reconnect
                      </button>
                      <button className="critical" onClick={() => disconnect(store)} disabled={busyId === store.id}>
                        Disconnect
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Add a store</h2>
        <div className="row end">
          <div className="field" style={{ minWidth: 220 }}>
            <label>Daraz country/site</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={addStore} disabled={adding}>
            {adding ? "Redirecting..." : "Connect a Daraz account"}
          </button>
        </div>
      </div>
    </>
  );
}
