import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

interface AuthApi {
  loggedIn: boolean | null; // null while checking
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ loggedIn: boolean }>("/auth/status")
      .then((res) => setLoggedIn(res.loggedIn))
      .catch(() => setLoggedIn(false));
  }, []);

  const login = async (username: string, password: string) => {
    await api.post("/auth/login", { username, password });
    setLoggedIn(true);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setLoggedIn(false);
  };

  return <AuthContext.Provider value={{ loggedIn, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
