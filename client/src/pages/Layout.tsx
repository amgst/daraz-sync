import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useStores } from "../StoreContext";

export default function Layout() {
  const { logout } = useAuth();
  const { stores, currentStoreId, switchStore, loading } = useStores();

  return (
    <div className="app-shell">
      <nav className="nav">
        <span className="brand">Daraz Sync</span>
        {!loading && stores.length > 0 && (
          <select
            className="store-switcher"
            value={currentStoreId ?? ""}
            onChange={(e) => switchStore(e.target.value)}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.countryLabel})
              </option>
            ))}
          </select>
        )}
        <NavLink to="/" end>
          Dashboard
        </NavLink>
        {!loading && stores.length > 0 && (
          <>
            <NavLink to="/daraz">Daraz connection</NavLink>
            <NavLink to="/products">Products</NavLink>
            <NavLink to="/orders">Orders</NavLink>
          </>
        )}
        <NavLink to="/stores">Stores</NavLink>
        <div className="spacer" />
        <button className="logout" onClick={() => logout()}>
          Log out
        </button>
      </nav>
      <div className="page">
        <Outlet />
      </div>
    </div>
  );
}
