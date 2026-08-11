import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(email, password);
      // No store connected yet - send them straight to the connect flow
      // instead of an empty dashboard.
      navigate("/daraz", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Create your account</h1>
        <div className="stack">
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="small subdued" style={{ marginTop: 4, marginBottom: 0 }}>
              At least 8 characters.
            </p>
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Creating account..." : "Sign up"}
          </button>
          {error && <div className="error-text">{error}</div>}
        </div>
        <p className="small subdued" style={{ textAlign: "center", marginTop: 14 }}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
