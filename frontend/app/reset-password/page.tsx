"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";

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

  return (
    <div
      className="min-h-screen flex flex-col bg-surface-base text-fg"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 80% 60% at 10% 10%, var(--radial-1) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 90% 90%, var(--radial-2) 0%, transparent 60%)",
      }}
    >
      <div className="flex items-center justify-between px-6 py-4">
        <Link href="/login" className="flex items-center gap-2">
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={28} height={28} />
          <span className="text-base font-extrabold bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
            RecruitX
          </span>
        </Link>
        <ThemeToggle />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-12">
        <div className="glass-card w-full max-w-md p-8 sm:p-10">
          <div className="text-center mb-8">
            <Image src="/LogoWithoutName.svg" alt="RecruitX" width={48} height={48} className="object-contain mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-fg mb-2 tracking-tight">Set New Password</h1>
            <p className="text-fg-muted text-sm">Choose a strong password for your account.</p>
          </div>

          {!done && token && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="block text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">New Password</label>
                <input type="password" required placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="glass-input w-full" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">Confirm Password</label>
                <input type="password" required placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} className="glass-input w-full" />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-br from-accent to-accent-2 text-on-accent text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? "Updating..." : "Update Password"}
              </button>
            </form>
          )}

          {status && (
            <div className={`mt-4 p-3 rounded-xl text-sm border ${
              status.type === "success" ? "bg-success/10 border-success/30 text-success" :
              status.type === "error" ? "bg-danger/10 border-danger/30 text-danger" :
              "bg-accent/10 border-accent/30 text-accent"
            }`}>
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

export default function ResetPasswordPage() {
  return <Suspense><ResetForm /></Suspense>;
}
