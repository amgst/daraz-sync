import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ToastState {
  id: number;
  message: string;
  isError: boolean;
}

interface ToastApi {
  show: (message: string, options?: { isError?: boolean }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const show = useCallback((message: string, options?: { isError?: boolean }) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, isError: options?.isError ?? false }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 1000,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.isError ? "#b3261e" : "#1d2129",
              color: "#fff",
              padding: "10px 16px",
              borderRadius: 8,
              fontSize: 13.5,
              boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
