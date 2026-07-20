"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import ScorecardDetailModal, { ScorecardMeeting } from "@/components/ScorecardDetailModal";

const G = "rgba(255,255,255,";
const card: React.CSSProperties = {
  background: `${G}0.05)`,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.10)`,
  borderRadius: 14,
  padding: 24,
};

interface Candidate {
  _id: string; name: string; email: string; roleName?: string;
  interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
  currentCompany?: string; experienceYears?: string;
}

interface ScheduledInterview {
  _id: string; candidateName: string; roleName: string;
  scheduledAt: number; status: string; attemptNumber?: number;
}

const STATUS_LABEL: Record<string, string> = {
  never_invited: "Not Invited", attempt_1_scheduled: "Scheduled",
  attempt_2_scheduled: "Retry Sched.", cooldown: "Cooldown",
  locked: "Final/Locked", completed: "Completed", partial: "Partial", no_show: "No Show",
};

function statusColor(s: string): [string, string] {
  const m: Record<string, [string, string]> = {
    never_invited:       [`${G}0.06)`, "#94a3b8"],
    attempt_1_scheduled: ["rgba(59,130,246,0.15)", "#93c5fd"],
    attempt_2_scheduled: ["rgba(59,130,246,0.15)", "#93c5fd"],
    cooldown:            ["rgba(245,158,11,0.15)", "#fbbf24"],
    locked:              ["rgba(239,68,68,0.15)", "#fca5a5"],
    completed:           ["rgba(16,185,129,0.15)", "#6ee7b7"],
    partial:             ["rgba(234,179,8,0.15)", "#fde047"],
    no_show:             ["rgba(245,158,11,0.15)", "#fbbf24"],
  };
  return m[s] || [`${G}0.06)`, "#94a3b8"];
}

export default function RecruiterDashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [meetings, setMeetings] = useState<ScorecardMeeting[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledInterview[]>([]);
  const [modal, setModal] = useState<ScorecardMeeting[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api("/api/candidates").then(r => r.json()).then(d => setCandidates(d.candidates || [])),
      api("/api/meetings").then(r => r.json()).then(d => setMeetings(d.meetings || [])),
      api("/api/interviews/scheduled").then(r => r.json()).then(d => setScheduled(d.interviews || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // Compute stats
  const scored = meetings.filter(m => m.scorecard?.overall_score);
  const avgScore = scored.length
    ? (scored.reduce((a, m) => a + (m.scorecard?.overall_score || 0), 0) / scored.length).toFixed(1)
    : "—";
  const completedCount = candidates.filter(c => ["locked", "completed"].includes(c.interviewStatus || "")).length;
  const upcomingCount = scheduled.filter(s => s.status === "pending").length;
  const liveCount = scheduled.filter(s => s.status === "active").length;
  const hireCount = scored.filter(m => ["HIRE", "STRONG HIRE"].includes(m.scorecard?.recommendation || "")).length;
  const cooldownCount = candidates.filter(c => c.interviewStatus === "cooldown").length;

  const statusBreakdown: Record<string, number> = {};
  candidates.forEach(c => {
    const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  });

  const recentCandidates = [...candidates].slice(-6).reverse();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weeklyTop = [...scored]
    .filter(m => m.scorecard?.overall_score && Date.now() - ((m as unknown as { createdAt?: number }).createdAt || 0) < weekMs)
    .sort((a, b) => (b.scorecard?.overall_score || 0) - (a.scorecard?.overall_score || 0))
    .slice(0, 5);

  const quickActions = [
    { icon: "👤", label: "Add Candidate", desc: "Register a new candidate profile", href: "/recruiter/add" },
    { icon: "📅", label: "Schedule Interview", desc: "Set up an AI interview session", href: "/recruiter/schedule" },
    { icon: "🔴", label: "Live Monitor", desc: "Watch interviews in real time", href: "/recruiter/live" },
    { icon: "📋", label: "View History", desc: "Browse past interviews & scores", href: "/recruiter/history" },
    { icon: "✨", label: "Generate Prompt", desc: "Create AI interview prompts", href: "/recruiter/prompts" },
    { icon: "🏆", label: "Scorecards", desc: "Review AI evaluation results", href: "/recruiter/scorecards" },
  ];

  const statCards = [
    { label: "Total Candidates", val: candidates.length, icon: "👥", accent: "#a78bfa" },
    { label: "Upcoming Interviews", val: upcomingCount, icon: "📅", accent: "#60a5fa" },
    { label: "Completed", val: completedCount, icon: "✅", accent: "#34d399" },
    { label: "Avg Score", val: avgScore, icon: "📊", accent: "#fbbf24" },
    { label: "Hire Ready", val: hireCount, icon: "🎯", accent: "#a78bfa" },
    { label: "In Cooldown", val: cooldownCount, icon: "🕐", accent: "#f97316" },
    { label: "Live Now", val: liveCount, icon: "🔴", accent: "#ef4444" },
    { label: "Interviews Done", val: scored.length, icon: "🏁", accent: "#34d399" },
  ];

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ color: "#94a3b8", fontSize: 15 }}>Loading dashboard...</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Dashboard</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        {statCards.map(s => (
          <div key={s.label} style={{ ...card, padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.accent }}>{s.val}</div>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

        {/* Quick Actions */}
        <div style={{ ...card }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px" }}>Quick Actions</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {quickActions.map(a => (
              <Link key={a.href} href={a.href} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 10, textDecoration: "none", transition: "all .15s",
              }}>
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{a.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, lineHeight: 1.4 }}>{a.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Interview Status Breakdown */}
        <div style={{ ...card }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px" }}>Candidate Status Breakdown</h2>
          {Object.keys(statusBreakdown).length === 0 ? (
            <div style={{ color: "#64748b", textAlign: "center", padding: "30px 0", fontSize: 13 }}>No candidates yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(statusBreakdown).map(([s, count]) => {
                const [bg, col] = statusColor(s);
                const pct = candidates.length ? Math.round((count / candidates.length) * 100) : 0;
                return (
                  <div key={s}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ background: bg, color: col, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                        {STATUS_LABEL[s] || s.replace(/_/g, " ")}
                      </span>
                      <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{count} · {pct}%</span>
                    </div>
                    <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99 }}>
                      <div style={{ height: 4, width: `${pct}%`, background: col, borderRadius: 99, transition: "width .4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* Recent Candidates */}
        <div style={{ ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>Recent Candidates</h2>
            <Link href="/recruiter/candidates" style={{ fontSize: 12, color: "#a78bfa", textDecoration: "none", fontWeight: 600 }}>View all →</Link>
          </div>
          {recentCandidates.length === 0 ? (
            <div style={{ color: "#64748b", textAlign: "center", padding: "30px 0", fontSize: 13 }}>
              No candidates yet. <Link href="/recruiter/add" style={{ color: "#a78bfa" }}>Add one →</Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentCandidates.map(c => {
                const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
                const [bg, col] = statusColor(s);
                return (
                  <Link key={c._id} href={`/recruiter/candidates/${c._id}`} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 12px", background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10,
                    textDecoration: "none", transition: "all .15s",
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                        {c.roleName || "No role"}{c.currentCompany ? ` · ${c.currentCompany}` : ""}
                      </div>
                    </div>
                    <span style={{ background: bg, color: col, padding: "2px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                      {STATUS_LABEL[s] || s.replace(/_/g, " ")}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Weekly Top Performers */}
        <div style={{ ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>Top Performers (This Week)</h2>
            <Link href="/recruiter/history" style={{ fontSize: 12, color: "#a78bfa", textDecoration: "none", fontWeight: 600 }}>History →</Link>
          </div>
          {weeklyTop.length === 0 ? (
            <div style={{ color: "#64748b", textAlign: "center", padding: "30px 0", fontSize: 13 }}>
              No scored interviews this week
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {weeklyTop.map((m, i) => {
                const score = m.scorecard?.overall_score || 0;
                const scoreColor = score >= 7 ? "#34d399" : score >= 5 ? "#fbbf24" : "#f87171";
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: i === 0 ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.05)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 800, color: i === 0 ? "#fbbf24" : "#94a3b8",
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.candidateName}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{m.roleName}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{ background: `rgba(${scoreColor === "#34d399" ? "52,211,153" : scoreColor === "#fbbf24" ? "251,191,36" : "248,113,113"},0.15)`, color: scoreColor, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>
                        {score}/10
                      </span>
                    </div>
                  </div>
                );
              })}
              {modal && (
                <ScorecardDetailModal meetings={modal} onClose={() => setModal(null)} dashboardUrl="/recruiter" />
              )}
            </div>
          )}
        </div>

      </div>

      {/* Upcoming Scheduled */}
      {scheduled.filter(s => s.status === "pending").length > 0 && (
        <div style={{ ...card, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>Upcoming Interviews</h2>
            <Link href="/recruiter/schedule" style={{ fontSize: 12, color: "#a78bfa", textDecoration: "none", fontWeight: 600 }}>Manage →</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {scheduled.filter(s => s.status === "pending").slice(0, 5).map(iv => (
              <div key={iv._id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", background: "rgba(59,130,246,0.06)",
                border: "1px solid rgba(59,130,246,0.15)", borderRadius: 10,
              }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{iv.candidateName}</span>
                  <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>{iv.roleName}</span>
                  {iv.attemptNumber === 2 && (
                    <span style={{ marginLeft: 8, background: "rgba(245,158,11,0.15)", color: "#fbbf24", padding: "1px 7px", borderRadius: 20, fontSize: 10, fontWeight: 700 }}>Retry</span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: "#93c5fd", fontWeight: 600 }}>
                  {new Date(iv.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {new Date(iv.scheduledAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
