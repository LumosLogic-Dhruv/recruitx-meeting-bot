"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { logout, getUser } from "@/lib/api";

const NAV = [
  { href: "/recruiter/add",        icon: "👤", label: "Candidates" },
  { href: "/recruiter/schedule",   icon: "📅", label: "Schedule Interview" },
  { href: "/recruiter/live",       icon: "🔴", label: "Live Interview" },
  { href: "/recruiter/scorecards", icon: "📊", label: "Scorecards" },
  { href: "/recruiter/prompts",    icon: "✨", label: "Generate Prompt" },
];

export default function RecruiterSidebar() {
  const pathname = usePathname();
  const user = getUser();

  return (
    <aside style={{
      width: 220, background: "#fff", borderRight: "1px solid #e2e8f0",
      display: "flex", flexDirection: "column", padding: "24px 0",
      position: "fixed", top: 0, left: 0, height: "100vh", zIndex: 10,
    }}>
      <div style={{ padding: "0 20px 24px", borderBottom: "1px solid #e2e8f0", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={28} height={28} />
          <span style={{ fontSize: 20, fontWeight: 800, color: "#7c3aed" }}>RecruitX</span>
        </div>
        <span style={{
          display: "inline-block", background: "#ede9fe", color: "#7c3aed",
          padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, marginTop: 6,
        }}>Recruiter</span>
      </div>

      <nav style={{ flex: 1 }}>
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href || (href === "/recruiter/add" && pathname.startsWith("/recruiter/candidates"));
          return (
            <Link key={href} href={href} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "11px 20px",
              fontSize: 14, fontWeight: 600, textDecoration: "none",
              color: active ? "#7c3aed" : "#64748b",
              background: active ? "#f5f3ff" : "transparent",
              borderLeft: `3px solid ${active ? "#7c3aed" : "transparent"}`,
              transition: "all .15s",
            }}>
              <span style={{ width: 18, textAlign: "center" }}>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: "16px 20px", borderTop: "1px solid #e2e8f0" }}>
        {user && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.name}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.email}
            </div>
          </>
        )}
        <button
          onClick={logout}
          style={{
            marginTop: 10, background: "#f1f5f9", border: "none",
            padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            cursor: "pointer", width: "100%",
          }}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
