import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

type Role = "admin" | "customer" | null;

interface AuthApi {
  loggedIn: boolean | null; // null while checking
  role: Role;
  login: (username: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role>(null);

  useEffect(() => {
    api
      .get<{ loggedIn: boolean; role: Role }>("/auth/status")
      .then((res) => {
        setLoggedIn(res.loggedIn);
        setRole(res.role);
      })
      .catch(() => setLoggedIn(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.post<{ ok: true; role: Role }>("/auth/login", { username, password });
    setLoggedIn(true);
    setRole(res.role);
  };

  const signup = async (email: string, password: string) => {
    const res = await api.post<{ ok: true; role: Role }>("/auth/signup", { email, password });
    setLoggedIn(true);
    setRole(res.role);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setLoggedIn(false);
    setRole(null);
  };

  return <AuthContext.Provider value={{ loggedIn, role, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
