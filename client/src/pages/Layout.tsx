import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useStores } from "../StoreContext";

export default function Layout() {
  const { logout, role } = useAuth();
  const { stores, currentStoreId, switchStore, loading } = useStores();
  const location = useLocation();
  const isAdmin = role === "admin";

  // Covers both a fresh customer signup (no store connected yet) and a
  // fresh admin deployment (nothing connected yet) - /daraz and /stores both
  // offer the same "connect a Daraz account" form, so either is a valid
  // landing spot and neither should bounce back to itself.
  if (!loading && stores.length === 0 && location.pathname !== "/daraz" && location.pathname !== "/stores") {
    return <Navigate to="/daraz" replace />;
  }

  return (
    <div className="app-shell">
      <nav className="nav">
        <span className="brand">Daraz Sync</span>
        {isAdmin && !loading && stores.length > 0 && (
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
        {isAdmin && <NavLink to="/stores">Stores</NavLink>}
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
