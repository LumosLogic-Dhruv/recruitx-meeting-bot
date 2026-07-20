"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

const darkCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(255,255,255,0.10)", borderRadius: 24, padding: 40,
  width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
};
const darkPage: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh",
  background: "#07070f",
  backgroundImage: "radial-gradient(ellipse 80% 60% at 10% 10%, rgba(139,92,246,0.18) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 90% 90%, rgba(99,102,241,0.12) 0%, transparent 60%)",
  padding: 20,
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus({ msg: "Sending reset link...", type: "info" });
    try {
      const res = await fetch(`${BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setStatus({ msg: "✓ If that email is registered, a reset link has been sent. Check your inbox.", type: "success" });
    } catch (err: unknown) {
      setStatus({ msg: err instanceof Error ? err.message : "Error", type: "error" });
    } finally { setLoading(false); }
  }

  const statusColor = (type: string) => type === "success" ? "#34d399" : type === "error" ? "#f87171" : "#c4b5fd";

  return (
    <div style={darkPage}>
      <div style={darkCard}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Link href="/login">
            <Image src="/LogoWithoutName.svg" alt="RecruitX" width={48} height={48} style={{ objectFit: "contain", marginBottom: 16 }} />
          </Link>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>Forgot Password?</h1>
          <p style={{ color: "#64748b", fontSize: 14 }}>Enter your email and we&apos;ll send a reset link.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Email Address</label>
            <input
              type="email" required placeholder="name@company.com" value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#f1f5f9", fontSize: 14, padding: "12px 14px", outline: "none", fontFamily: "inherit" }}
            />
          </div>
          <button type="submit" disabled={loading} style={{ width: "100%", padding: "12px 24px", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1, background: "linear-gradient(135deg,#8b5cf6,#7c3aed)", color: "#fff" }}>
            {loading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        {status && (
          <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 10, fontSize: 13, background: status.type === "success" ? "rgba(16,185,129,0.1)" : status.type === "error" ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)", border: `1px solid ${status.type === "success" ? "rgba(16,185,129,0.3)" : status.type === "error" ? "rgba(239,68,68,0.3)" : "rgba(139,92,246,0.3)"}`, color: statusColor(status.type) }}>
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
