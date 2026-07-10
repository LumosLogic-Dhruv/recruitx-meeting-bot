"use client";
import { useEffect } from "react";
import { checkSession, getUser, logout } from "@/lib/api";
import RecruiterSidebar from "@/components/RecruiterSidebar";

export default function RecruiterLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "/login"; return; }
    checkSession().then(async (ok) => {
      if (!ok) { logout(); return; }
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/auth/me`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user?.role === "admin") { window.location.href = "/admin"; }
      }
    });
    const user = getUser();
    if (user?.role === "admin") window.location.href = "/admin";
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f8fafc" }}>
      <RecruiterSidebar />
      <main style={{ marginLeft: 220, flex: 1, padding: 32 }}>
        {children}
      </main>
    </div>
  );
}
