"use client";
import { useEffect } from "react";
import { getUser, logout } from "@/lib/api";
import RecruiterSidebar, { NAV, isActive } from "@/components/RecruiterSidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/ThemeToggle";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function RecruiterLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "/login"; return; }

    const user = getUser();
    if (user?.role === "admin") { window.location.href = "/admin"; return; }

    fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.status === 401) { logout(); return; }
        if (res.ok) return res.json().then((data: { user?: { role?: string } }) => {
          if (data.user?.role === "admin") { window.location.href = "/admin"; }
        });
      })
      .catch(() => {});
  }, []);

  // Filter NAV for mobile (only show max 5 items to fit screen)
  const mobileNav = NAV.slice(0, 5);

  return (
    <div className="flex min-h-screen bg-surface-base relative">
      <RecruiterSidebar />
      
      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 w-full bg-surface-1/90 backdrop-blur-xl border-t border-outline/10 z-50 flex items-center justify-around py-2 px-2 pb-6">
        {mobileNav.map(({ href, icon, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link key={href} href={href} className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-lg transition-colors ${
              active ? "text-accent font-bold" : "text-fg-muted font-medium hover:text-fg"
            }`}>
              <span className="text-xl leading-none">{icon}</span>
              <span className="text-[10px] mt-0.5">{label}</span>
            </Link>
          );
        })}
        <div className="flex flex-col items-center justify-center">
          <ThemeToggle />
        </div>
      </div>

      <main className="flex-1 w-full md:ml-56 p-4 sm:p-6 lg:p-8 min-h-[100dvh] max-w-full overflow-x-hidden pb-24 md:pb-8 bg-surface-base text-fg">
        {children}
      </main>
    </div>
  );
}
