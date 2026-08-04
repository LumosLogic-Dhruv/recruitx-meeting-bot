"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { checkSession } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      window.location.href = data.user?.role === "admin" ? "/admin" : "/recruiter";
    } catch (err: unknown) {
      setStatus({ msg: err instanceof Error ? err.message : "Login failed", type: "error" });
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-surface-base text-fg"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 80% 60% at 10% 10%, var(--radial-1) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 90% 90%, var(--radial-2) 0%, transparent 60%)",
      }}
    >
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={28} height={28} />
          <span className="text-base font-extrabold bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
            RecruitX
          </span>
        </Link>
        <ThemeToggle />
      </div>

      {/* Centered card */}
      <div className="flex-1 flex items-center justify-center px-4 pb-12">
        <div className="glass-card w-full max-w-md p-8 sm:p-10">
          <div className="text-center mb-8">
            <Link href="/">
              <Image
                src="/LogoWithoutName.svg"
                alt="RecruitX"
                width={48}
                height={48}
                className="object-contain mx-auto mb-4"
              />
            </Link>
            <h1 className="text-2xl font-bold text-fg mb-2 tracking-tight">Welcome Back</h1>
            <p className="text-fg-muted text-sm">
              Sign in to orchestrate interview bots &amp; view transcripts
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="block text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="glass-input w-full"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="glass-input w-full pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg transition-colors p-1 cursor-pointer bg-transparent border-none"
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
              type="submit"
              disabled={loading}
              className={`w-full mt-1 py-3 bg-gradient-to-br from-accent to-accent-2 text-on-accent text-sm font-bold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 ${
                loading ? "opacity-70 cursor-wait" : "cursor-pointer"
              }`}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Signing in…</span>
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {status && (
            <div
              className={`mt-4 p-3 rounded-xl text-sm border ${
                status.type === "success"
                  ? "bg-success/10 border-success/30 text-success"
                  : status.type === "error"
                  ? "bg-danger/10 border-danger/30 text-danger"
                  : "bg-accent/10 border-accent/30 text-accent"
              }`}
            >
              {status.msg}
            </div>
          )}

          <div className="text-center mt-4">
            <Link href="/forgot-password" className="text-fg-muted text-sm hover:text-fg transition-colors">
              Forgot your password?
            </Link>
          </div>
          <div className="text-center mt-3 text-sm text-fg-muted">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-accent font-semibold hover:opacity-80 transition-opacity">
              Sign Up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
