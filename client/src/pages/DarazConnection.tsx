import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../ToastContext";

const COUNTRY_OPTIONS = [
  { value: "PK", label: "Pakistan" },
  { value: "BD", label: "Bangladesh" },
  { value: "LK", label: "Sri Lanka" },
  { value: "NP", label: "Nepal" },
  { value: "MM", label: "Myanmar" },
];

interface Status {
  connected: boolean;
  country?: string;
  countryLabel?: string;
  sellerId?: string | null;
  connectedAt?: string;
}

export default function DarazConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [country, setCountry] = useState("PK");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const load = () => api.get<Status>("/daraz/status").then(setStatus);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (searchParams.get("connected")) {
      toast.show("Daraz account connected");
      load();
      setSearchParams({}, { replace: true });
    } else if (searchParams.get("error")) {
      toast.show(searchParams.get("error")!, { isError: true });
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await api.post<{ authorizeUrl: string }>("/daraz/connect", { country });
      window.location.href = res.authorizeUrl;
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Failed to start connection", { isError: true });
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await api.post("/daraz/disconnect");
      toast.show("Daraz account disconnected");
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>("/daraz/test-connection");
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  };

  if (!status) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Daraz connection</h1>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h2>Daraz seller account</h2>
          <span className={`badge ${status.connected ? "synced" : "unmapped"}`}>
            {status.connected ? "Connected" : "Not connected"}
          </span>
        </div>

        {status.connected ? (
          <div className="stack">
            <p>
              Connected to Daraz {status.countryLabel}
              {status.sellerId ? ` (seller ${status.sellerId})` : ""}.
            </p>
            <div className="row">
              <button onClick={testConnection} disabled={testing}>
                {testing ? "Testing..." : "Test connection"}
              </button>
              <button className="critical" onClick={disconnect} disabled={disconnecting}>
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
            {testResult && (
              <p className={testResult.ok ? "small" : "error-text"}>{testResult.message}</p>
            )}
          </div>
        ) : (
          <div className="stack">
            <p className="subdued">Connect your Daraz seller account to start managing products.</p>
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
              <button className="primary" onClick={connect} disabled={connecting}>
                {connecting ? "Redirecting..." : "Connect Daraz account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
