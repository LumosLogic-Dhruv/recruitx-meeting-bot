"use client";
import { useEffect } from "react";
import { getUser, logout } from "@/lib/api";
import RecruiterSidebar from "@/components/RecruiterSidebar";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function RecruiterLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "/login"; return; }

    // Fast path: use cached user to redirect admin immediately (no network needed)
    const user = getUser();
    if (user?.role === "admin") { window.location.href = "/admin"; return; }

    // Validate token with backend — only logout on a definitive 401.
    // Network errors / 5xx (e.g. Render cold-start slowness) must NOT remove
    // a valid token and force the user back to the login page.
    fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.status === 401) { logout(); return; }
        if (res.ok) return res.json().then((data: { user?: { role?: string } }) => {
          if (data.user?.role === "admin") { window.location.href = "/admin"; }
        });
        // 5xx or other errors — backend issue, keep the user on the page
      })
      .catch(() => {
        // Network error — don't logout; the backend might just be slow to wake up
      });
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#07070f" }}>
      <RecruiterSidebar />
      <main style={{ marginLeft: 220, flex: 1, padding: 32, minHeight: "100vh" }}>
        {children}
      </main>
    </div>
  );
}
