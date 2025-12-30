import { useState } from "react";
import { AuthForm } from "./AuthForm";
import { authClient } from "./auth-client";
import "./index.css";

function APITester() {
  const [result, setResult] = useState<{ endpoint: string; status: number; data: unknown } | null>(null);
  const [loading, setLoading] = useState(false);

  const testAPI = async (endpoint: string) => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      const data = await res.json();
      setResult({ endpoint, status: res.status, data });
    } catch (err) {
      setResult({ endpoint, status: 0, data: { error: String(err) } });
    }
    setLoading(false);
  };

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 500 }}>API Tester</h3>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Public</div>
        <button
          onClick={() => testAPI("/api/health")}
          disabled={loading}
          style={{
            padding: "6px 12px",
            fontSize: 13,
            fontFamily: "monospace",
            background: "var(--border)",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          /api/health
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Protected</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => testAPI("/api/me")}
            disabled={loading}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontFamily: "monospace",
              background: "var(--border)",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            /api/me
          </button>
          <button
            onClick={() => testAPI("/api/admin")}
            disabled={loading}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontFamily: "monospace",
              background: "var(--border)",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            /api/admin
          </button>
        </div>
      </div>

      {result && (
        <div
          style={{
            background: result.status === 200 ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${result.status === 200 ? "#bbf7d0" : "#fecaca"}`,
            borderRadius: 6,
            padding: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <code style={{ fontSize: 13, color: "var(--muted)" }}>{result.endpoint}</code>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                fontWeight: 500,
                color: result.status === 200 ? "#16a34a" : "#dc2626",
              }}
            >
              {result.status}
            </span>
          </div>
          <pre style={{ margin: 0, fontSize: 12, fontFamily: "monospace", color: "var(--muted)", overflow: "auto" }}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function UserProfile({
  user,
  onSignOut,
}: {
  user: { id: string; email: string; name?: string };
  onSignOut: () => void;
}) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 500 }}>{user.name || "User"}</div>
        <div style={{ fontSize: 14, color: "var(--muted)" }}>{user.email}</div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
        ID: {user.id.slice(0, 16)}...
      </div>
      <button
        onClick={onSignOut}
        style={{
          width: "100%",
          padding: "8px 16px",
          fontSize: 14,
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Sign Out
      </button>
    </div>
  );
}

export function App() {
  const { data: session, isPending } = authClient.useSession();

  const handleSignOut = async () => {
    await authClient.signOut();
  };

  if (isPending) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "20px 24px" }}>
        <div style={{ maxWidth: 400, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 80 80" fill="none">
            <path d="M40 70c16.569 0 30-13.431 30-30 0-16.569-13.431-30-30-30C23.431 10 10 23.431 10 40c0 16.569 13.431 30 30 30z" fill="#fbf0df"/>
            <path d="M35.5 32c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5c0 1.5-.7 2.8-1.8 3.6-.7.5-1.2 1.3-1.2 2.2v.7h-3v-.7c0-1.8.9-3.4 2.4-4.4.5-.3.6-.8.6-1.4 0-.8-.7-1.5-1.5-1.5s-1.5.7-1.5 1.5h-3zm3 13h3v3h-3v-3z" fill="#f6dece"/>
            <ellipse cx="28" cy="52" rx="4" ry="2.5" fill="#f6dece"/>
            <ellipse cx="52" cy="52" rx="4" ry="2.5" fill="#f6dece"/>
            <circle cx="30" cy="42" r="2" fill="#3b3022"/>
            <circle cx="50" cy="42" r="2" fill="#3b3022"/>
            <path d="M36 50c0 0 2 3 4 3s4-3 4-3" stroke="#3b3022" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Bun</span>
          <span style={{ color: "var(--muted)", fontSize: 14 }}>+</span>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#61dafb">
            <circle cx="12" cy="12" r="2"/>
            <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="#61dafb" strokeWidth="1"/>
            <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="#61dafb" strokeWidth="1" transform="rotate(60 12 12)"/>
            <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="#61dafb" strokeWidth="1" transform="rotate(120 12 12)"/>
          </svg>
          <span style={{ fontSize: 15, fontWeight: 500 }}>React</span>
        </div>
      </header>

      <main style={{ flex: 1, padding: "48px 24px" }}>
        <div style={{ maxWidth: 400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {session ? (
            <UserProfile
              user={{
                id: session.user.id,
                email: session.user.email || "",
                name: session.user.name,
              }}
              onSignOut={handleSignOut}
            />
          ) : (
            <AuthForm onSuccess={() => window.location.reload()} />
          )}
          <APITester />
        </div>
      </main>

      <footer style={{ padding: "20px 24px", textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Bun + React + Tailwind + OnePipe + better-auth
        </span>
      </footer>
    </div>
  );
}

export default App;
