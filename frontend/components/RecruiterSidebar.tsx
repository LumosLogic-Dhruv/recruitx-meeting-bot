"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { logout, getUser } from "@/lib/api";
import { useEffect, useState } from "react";

export const NAV = [
  { href: "/recruiter",            icon: "📊", label: "Dashboard" },
  { href: "/recruiter/candidates", icon: "👥", label: "Candidates" },
  { href: "/recruiter/history",    icon: "📋", label: "History" },
  { href: "/recruiter/schedule",   icon: "📅", label: "Schedule" },
  { href: "/recruiter/live",       icon: "🔴", label: "Live" },
  { href: "/recruiter/scorecards", icon: "🏆", label: "Scorecards" },
  { href: "/recruiter/prompts",    icon: "✨", label: "Prompts" },
];

export function isActive(href: string, pathname: string) {
  if (href === "/recruiter") return pathname === "/recruiter";
  if (href === "/recruiter/candidates") {
    return pathname.startsWith("/recruiter/candidates") || pathname === "/recruiter/add";
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export default function RecruiterSidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<{name: string, email: string} | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  return (
    <aside className="hidden md:flex flex-col w-56 fixed top-0 left-0 h-screen bg-surface-1/90 backdrop-blur-xl border-r border-outline/10 py-6 z-10 transition-colors">
      {/* Logo */}
      <div className="px-5 pb-5 border-b border-outline/10 mb-2">
        <div className="flex items-center gap-2">
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={28} height={28} />
          <span className="text-[19px] font-extrabold bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
            RecruitX
          </span>
        </div>
        <span className="inline-block bg-accent/15 text-accent px-2.5 py-0.5 rounded-full text-[10px] font-bold mt-1.5 border border-accent/25 tracking-wider uppercase">
          Recruiter
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto pt-1">
        {NAV.map(({ href, icon, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link key={href} href={href} className={`flex items-center gap-2.5 px-5 py-2.5 text-[13px] transition-all border-l-[3px] ${
              active ? "font-bold text-accent bg-accent/10 border-accent" : "font-medium text-fg-muted border-transparent hover:bg-surface-sunken hover:text-fg"
            }`}>
              <span className="w-[18px] text-center text-sm">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-5 pt-4 border-t border-outline/10">
        {user && (
          <div className="mb-2.5">
            <div className="text-[13px] font-semibold text-fg truncate">{user.name}</div>
            <div className="text-[11px] text-fg-muted truncate mt-0.5">{user.email}</div>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full bg-danger/10 border border-danger/20 text-danger py-[7px] px-3.5 rounded-lg text-xs font-semibold hover:bg-danger/20 transition-all cursor-pointer"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
