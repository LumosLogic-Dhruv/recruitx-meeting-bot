"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { checkSession } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) checkSession().then((ok) => { if (ok) window.location.href = "/dashboard"; });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Sign up failed");

      setStatus({ msg: "Account created! Logging you in...", type: "success" });

      const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginData.detail || "Auto-login failed");

      localStorage.setItem("token", loginData.token);
      localStorage.setItem("user", JSON.stringify(loginData.user));
      window.location.href = loginData.user?.role === "admin" ? "/admin" : "/recruiter";
    } catch (err: unknown) {
      setStatus({ msg: err instanceof Error ? err.message : "Sign up failed", type: "error" });
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10,
    color: "#f1f5f9", fontSize: 14, padding: "12px 14px", outline: "none", fontFamily: "inherit",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8",
    textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8,
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", width: "100vw",
      background: "#07070f",
      backgroundImage: "radial-gradient(ellipse 80% 60% at 10% 10%, rgba(139,92,246,0.18) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 90% 90%, rgba(99,102,241,0.12) 0%, transparent 60%)",
      padding: 20,
    }}>
      <div style={{
        background: "rgba(255,255,255,0.05)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.10)", borderRadius: 24, padding: 40,
        width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Link href="/">
            <Image src="/LogoWithoutName.svg" alt="RecruitX" width={48} height={48} style={{ objectFit: "contain", marginBottom: 16 }} />
          </Link>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "#f1f5f9", marginBottom: 8 }}>
            Create an Account
          </h1>
          <p style={{ color: "#64748b", fontSize: 14 }}>Get started with RecruitX AI Interviewer</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Full Name</label>
            <input type="text" required placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Email Address</label>
            <input type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                required placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...inputStyle, paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: "#94a3b8", display: "flex", alignItems: "center" }}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
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
            {loading ? "Creating account…" : "Sign Up"}
          </button>
        </form>

        {status && (
          <div style={{
            marginTop: 16, padding: "12px 16px", borderRadius: 10, fontSize: 13,
            background: status.type === "success" ? "rgba(16,185,129,0.1)" : status.type === "error" ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)",
            border: `1px solid ${status.type === "success" ? "#10b981" : status.type === "error" ? "#ef4444" : "#8b5cf6"}`,
            color: status.type === "success" ? "#34d399" : status.type === "error" ? "#f87171" : "#c4b5fd",
          }}>
            {status.msg}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 14, color: "#64748b" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#8b5cf6", textDecoration: "none", fontWeight: 600 }}>Sign In</Link>
        </div>
      </div>
    </div>
  );
}
