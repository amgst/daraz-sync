import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { ToastProvider } from "./ToastContext";
import { StoreProvider } from "./StoreContext";
import Layout from "./pages/Layout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import DarazConnection from "./pages/DarazConnection";
import Stores from "./pages/Stores";
import Products from "./pages/Products";
import ProductForm from "./pages/ProductForm";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";

function Protected({ children }: { children: React.ReactNode }) {
  const { loggedIn } = useAuth();
  if (loggedIn === null) return null;
  if (!loggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { loggedIn } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loggedIn ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={loggedIn ? <Navigate to="/" replace /> : <Signup />}
      />
      <Route
        path="/"
        element={
          <Protected>
            <StoreProvider>
              <Layout />
            </StoreProvider>
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="daraz" element={<DarazConnection />} />
        <Route
          path="stores"
          element={
            <RequireAdmin>
              <Stores />
            </RequireAdmin>
          }
        />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductForm />} />
        <Route path="products/:id" element={<ProductForm />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
      </Route>
      {/* Any unrecognized path (e.g. a broken external redirect) bounces
          home instead of rendering a blank page. */}
      <Route path="*" element={<Navigate to={loggedIn ? "/" : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  );
}
