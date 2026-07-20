"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { logout, getUser } from "@/lib/api";

const NAV = [
  { href: "/recruiter",            icon: "📊", label: "Dashboard" },
  { href: "/recruiter/candidates", icon: "👥", label: "Candidates" },
  { href: "/recruiter/history",    icon: "📋", label: "History" },
  { href: "/recruiter/schedule",   icon: "📅", label: "Schedule" },
  { href: "/recruiter/live",       icon: "🔴", label: "Live" },
  { href: "/recruiter/scorecards", icon: "🏆", label: "Scorecards" },
  { href: "/recruiter/prompts",    icon: "✨", label: "Prompts" },
];

function isActive(href: string, pathname: string) {
  if (href === "/recruiter") return pathname === "/recruiter";
  if (href === "/recruiter/candidates") {
    return pathname.startsWith("/recruiter/candidates") || pathname === "/recruiter/add";
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export default function RecruiterSidebar() {
  const pathname = usePathname();
  const user = getUser();

  return (
    <aside style={{
      width: 220,
      background: "rgba(8,8,17,0.88)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      borderRight: "1px solid rgba(255,255,255,0.07)",
      display: "flex",
      flexDirection: "column",
      padding: "24px 0",
      position: "fixed",
      top: 0,
      left: 0,
      height: "100vh",
      zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{
        padding: "0 20px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        marginBottom: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={28} height={28} />
          <span style={{
            fontSize: 19, fontWeight: 800,
            background: "linear-gradient(135deg,#a78bfa,#818cf8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>RecruitX</span>
        </div>
        <span style={{
          display: "inline-block",
          background: "rgba(139,92,246,0.15)",
          color: "#c4b5fd",
          padding: "2px 10px",
          borderRadius: 20,
          fontSize: 10,
          fontWeight: 700,
          marginTop: 6,
          border: "1px solid rgba(139,92,246,0.25)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}>Recruiter</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
        {NAV.map(({ href, icon, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link key={href} href={href} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              textDecoration: "none",
              color: active ? "#c4b5fd" : "#94a3b8",
              background: active ? "rgba(139,92,246,0.12)" : "transparent",
              borderLeft: `3px solid ${active ? "#8b5cf6" : "transparent"}`,
              transition: "all .15s",
            }}>
              <span style={{ width: 18, textAlign: "center", fontSize: 14 }}>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        {user && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.name}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>
              {user.email}
            </div>
          </>
        )}
        <button
          onClick={logout}
          style={{
            marginTop: 10,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.18)",
            color: "#f87171",
            padding: "7px 14px",
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            width: "100%",
            transition: "all .15s",
          }}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
