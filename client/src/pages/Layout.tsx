import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";

export default function Layout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <nav className="nav">
        <span className="brand">Daraz Sync</span>
        <NavLink to="/" end>
          Dashboard
        </NavLink>
        <NavLink to="/daraz">Daraz connection</NavLink>
        <NavLink to="/products">Products</NavLink>
        <NavLink to="/orders">Orders</NavLink>
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
