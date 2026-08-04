"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { checkSession } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { validateName, validateEmail, validatePassword } from "@/lib/validation";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);

  // Field validation errors
  const [nameErr, setNameErr] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [passErr, setPassErr] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) checkSession().then((ok) => { if (ok) window.location.href = "/dashboard"; });
  }, []);

  function handleNameChange(val: string) {
    setName(val);
    if (val.length > 300) {
      setNameErr("Full Name cannot exceed 300 characters.");
      return;
    }
    const res = validateName(val);
    setNameErr(res.isValid ? "" : res.error || "");
  }

  function handleEmailChange(val: string) {
    setEmail(val);
    const res = validateEmail(val);
    setEmailErr(res.isValid ? "" : res.error || "");
  }

  function handlePasswordChange(val: string) {
    setPassword(val);
    const res = validatePassword(val);
    setPassErr(res.isValid ? "" : res.error || "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    const nameRes = validateName(name);
    const emailRes = validateEmail(email);
    const passRes = validatePassword(password);

    setNameErr(nameRes.isValid ? "" : nameRes.error || "");
    setEmailErr(emailRes.isValid ? "" : emailRes.error || "");
    setPassErr(passRes.isValid ? "" : passRes.error || "");

    if (!nameRes.isValid || !emailRes.isValid || !passRes.isValid) {
      setStatus({ msg: "Please correct the errors before submitting.", type: "error" });
      return;
    }

    setLoading(true);
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
            <h1 className="text-2xl font-bold text-fg mb-2 tracking-tight">Create an Account</h1>
            <p className="text-fg-muted text-sm">Get started with RecruitX AI Interviewer</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="block text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">
                Full Name
              </label>
              <input
                type="text"
                required
                maxLength={300}
                placeholder="John Doe"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="glass-input w-full"
              />
              {nameErr && <p className="text-xs text-danger mt-1 font-medium">{nameErr}</p>}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                className="glass-input w-full"
              />
              {emailErr && <p className="text-xs text-danger mt-1 font-medium">{emailErr}</p>}
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
                  onChange={(e) => handlePasswordChange(e.target.value)}
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
              {passErr ? (
                <p className="text-xs text-danger mt-1 font-medium">{passErr}</p>
              ) : (
                <p className="text-[10px] text-fg-muted mt-1">
                  At least 8 chars with uppercase, lowercase, number & special char.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !!nameErr || !!emailErr || !!passErr}
              className="w-full mt-1 py-3 bg-gradient-to-br from-accent to-accent-2 text-on-accent text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Creating account…</span>
                </>
              ) : (
                "Sign Up"
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

          <div className="text-center mt-6 text-sm text-fg-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-accent font-semibold hover:opacity-80 transition-opacity">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
