"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

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
      setStatus({
        msg: "✓ If that email is registered, a reset link has been sent. Check your inbox.",
        type: "success",
      });
    } catch (err: unknown) {
      setStatus({ msg: err instanceof Error ? err.message : "Error", type: "error" });
    } finally {
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
            <Link href="/login">
              <Image
                src="/LogoWithoutName.svg"
                alt="RecruitX"
                width={48}
                height={48}
                className="object-contain mx-auto mb-4"
              />
            </Link>
            <h1 className="text-2xl font-bold text-fg mb-2 tracking-tight">Forgot Password?</h1>
            <p className="text-fg-muted text-sm">Enter your email and we&apos;ll send a reset link.</p>
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
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-br from-accent to-accent-2 text-on-accent text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? "Sending..." : "Send Reset Link"}
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

          <div className="text-center mt-6">
            <Link href="/login" className="text-accent text-sm font-semibold hover:opacity-80 transition-opacity">
              ← Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
