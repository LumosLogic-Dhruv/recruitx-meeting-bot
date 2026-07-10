"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setStatus({ msg: "Invalid reset link. Please request a new one.", type: "error" });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setStatus({ msg: "Passwords do not match.", type: "error" }); return; }
    if (password.length < 6) { setStatus({ msg: "Password must be at least 6 characters.", type: "error" }); return; }
    setLoading(true);
    setStatus({ msg: "Updating password...", type: "info" });
    try {
      const res = await fetch(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setStatus({ msg: "✓ Password updated! Redirecting to sign in...", type: "success" });
      setDone(true);
      setTimeout(() => { window.location.href = "/login"; }, 2000);
    } catch (err: unknown) {
      setStatus({ msg: err instanceof Error ? err.message : "Error", type: "error" });
    } finally { setLoading(false); }
  }

  const inp: React.CSSProperties = { width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0f172a", fontSize: 14, padding: "12px 14px", outline: "none", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "radial-gradient(circle at top right, rgba(139,92,246,0.08), transparent 40%), #f8fafc", padding: 20 }}>
      <div style={{ background: "rgba(255,255,255,0.8)", backdropFilter: "blur(16px)", border: "1px solid #e2e8f0", borderRadius: 24, padding: 40, width: "100%", maxWidth: 460, boxShadow: "0 10px 40px rgba(0,0,0,0.05)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={48} height={48} style={{ objectFit: "contain", marginBottom: 16 }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Set New Password</h1>
          <p style={{ color: "#64748b", fontSize: 14 }}>Choose a strong password for your account.</p>
        </div>

        {!done && token && (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={lbl}>New Password</label>
              <input type="password" required placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} style={inp} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={lbl}>Confirm Password</label>
              <input type="password" required placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} style={inp} />
            </div>
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "12px 24px", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1, background: "linear-gradient(135deg,#8b5cf6,#7c3aed)", color: "#fff" }}>
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}

        {status && (
          <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 10, fontSize: 13, background: status.type === "success" ? "rgba(16,185,129,0.1)" : status.type === "error" ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)", border: `1px solid ${status.type === "success" ? "#10b981" : status.type === "error" ? "#ef4444" : "#8b5cf6"}`, color: status.type === "success" ? "#065f46" : status.type === "error" ? "#991b1b" : "#6b21a8" }}>
            {status.msg}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 14, color: "#64748b" }}>
          <Link href="/login" style={{ color: "#8b5cf6", textDecoration: "none", fontWeight: 600 }}>← Back to Sign In</Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetForm /></Suspense>;
}
