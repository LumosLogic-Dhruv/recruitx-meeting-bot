"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { checkSession } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) checkSession().then((ok) => {
      if (ok) {
        const u = JSON.parse(localStorage.getItem("user") || "{}");
        window.location.href = u?.role === "admin" ? "/admin" : "/recruiter";
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Login failed");
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setStatus({ msg: "Login successful! Redirecting...", type: "success" });
      const role = data.user?.role || "recruiter";
      setTimeout(() => { window.location.href = role === "admin" ? "/admin" : "/recruiter"; }, 800);
    } catch (err: unknown) {
      setStatus({ msg: err instanceof Error ? err.message : "Login failed", type: "error" });
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", width: "100vw",
      background: "radial-gradient(circle at top right, rgba(139,92,246,0.08), transparent 40%), radial-gradient(circle at bottom left, rgba(76,29,149,0.06), transparent 45%), #f8fafc",
      padding: 20,
    }}>
      <div style={{
        background: "rgba(255,255,255,0.8)", backdropFilter: "blur(16px)",
        border: "1px solid #e2e8f0", borderRadius: 24, padding: 40,
        width: "100%", maxWidth: 460,
        boxShadow: "0 10px 40px rgba(0,0,0,0.05)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Link href="/">
            <Image src="/LogoWithoutName.svg" alt="RecruitX" width={48} height={48} style={{ objectFit: "contain", marginBottom: 16 }} />
          </Link>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "#0f172a", marginBottom: 8 }}>
            Welcome Back
          </h1>
          <p style={{ color: "#64748b", fontSize: 14 }}>Sign in to orchestrate interview bots &amp; view transcripts</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
              Email Address
            </label>
            <input
              type="email" required placeholder="name@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0f172a", fontSize: 14, padding: "12px 14px", outline: "none", fontFamily: "inherit" }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
              Password
            </label>
            <input
              type="password" required placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0f172a", fontSize: 14, padding: "12px 14px", outline: "none", fontFamily: "inherit" }}
            />
          </div>
          <button
            type="submit" disabled={loading}
            style={{
              width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center",
              padding: "12px 24px", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1,
              background: "linear-gradient(135deg, #8b5cf6, #7c3aed)", color: "#fff",
              boxShadow: "0 4px 15px rgba(139,92,246,0.2)",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        {status && (
          <div style={{
            marginTop: 16, padding: "12px 16px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
            background: status.type === "success" ? "rgba(16,185,129,0.1)" : status.type === "error" ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)",
            border: `1px solid ${status.type === "success" ? "#10b981" : status.type === "error" ? "#ef4444" : "#8b5cf6"}`,
            color: status.type === "success" ? "#065f46" : status.type === "error" ? "#991b1b" : "#6b21a8",
          }}>
            {status.msg}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 14, color: "#64748b" }}>
          Don&apos;t have an account?{" "}
          <Link href="/signup" style={{ color: "#8b5cf6", textDecoration: "none", fontWeight: 600 }}>Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
