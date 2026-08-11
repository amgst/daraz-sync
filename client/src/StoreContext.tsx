import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Store } from "./api";

interface StoreApi {
  stores: Store[];
  currentStoreId: string | null;
  currentStore: Store | null;
  loading: boolean;
  refresh: () => Promise<void>;
  switchStore: (id: string) => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const res = await api.get<{ stores: Store[]; currentStoreId: string | null }>("/stores");
    setStores(res.stores);
    setCurrentStoreId(res.currentStoreId);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A full reload is the simplest way to get every store-scoped page
  // (Products, Orders, Dashboard, ...) to refetch under the new store,
  // since none of them are otherwise aware the store can change mid-session.
  const switchStore = async (id: string) => {
    await api.post(`/stores/${id}/select`);
    window.location.reload();
  };

  const currentStore = stores.find((s) => s.id === currentStoreId) ?? null;

  return (
    <StoreContext.Provider value={{ stores, currentStoreId, currentStore, loading, refresh, switchStore }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStores(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStores must be used within a StoreProvider");
  return ctx;
}
