"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import ScorecardDetailModal, { ScorecardMeeting } from "@/components/ScorecardDetailModal";

// Helper for card styling
const cardClass = "bg-surface-1/40 backdrop-blur-xl border border-outline/10 rounded-2xl p-5 sm:p-6";

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
  locked: "Final", completed: "Completed", partial: "Partial", no_show: "No Show",
};

function statusColor(s: string): string {
  const m: Record<string, string> = {
    never_invited:       "bg-surface-sunken text-fg-muted",
    attempt_1_scheduled: "bg-info/15 text-info",
    attempt_2_scheduled: "bg-info/15 text-info",
    cooldown:            "bg-warning/15 text-warning",
    locked:              "bg-danger/15 text-danger",
    completed:           "bg-success/15 text-success",
    partial:             "bg-warning/15 text-warning",
    no_show:             "bg-warning/15 text-warning",
  };
  return m[s] || "bg-surface-sunken text-fg-muted";
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
    { icon: "👤", label: "Add Candidate", desc: "Register a new profile", href: "/recruiter/add" },
    { icon: "📅", label: "Schedule", desc: "Set up an AI session", href: "/recruiter/schedule" },
    { icon: "🔴", label: "Live Monitor", desc: "Watch in real time", href: "/recruiter/live" },
    { icon: "📋", label: "View History", desc: "Browse past scores", href: "/recruiter/history" },
    { icon: "✨", label: "Prompts", desc: "Create AI prompts", href: "/recruiter/prompts" },
    { icon: "🏆", label: "Scorecards", desc: "Review AI results", href: "/recruiter/scorecards" },
  ];

  const statCards = [
    { label: "Total Candidates", val: candidates.length, icon: "👥", accent: "text-accent" },
    { label: "Upcoming", val: upcomingCount, icon: "📅", accent: "text-info" },
    { label: "Completed", val: completedCount, icon: "✅", accent: "text-success" },
    { label: "Avg Score", val: avgScore, icon: "📊", accent: "text-warning" },
    { label: "Hire Ready", val: hireCount, icon: "🎯", accent: "text-accent" },
    { label: "In Cooldown", val: cooldownCount, icon: "🕐", accent: "text-warning" },
    { label: "Live Now", val: liveCount, icon: "🔴", accent: "text-danger" },
    { label: "Interviews Done", val: scored.length, icon: "🏁", accent: "text-success" },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="text-fg-muted font-medium text-sm">Loading dashboard...</div>
    </div>
  );

  return (
    <div className="w-full max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-fg m-0">Dashboard</h1>
        <p className="mt-1 text-xs sm:text-sm text-fg-muted">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {statCards.map(s => (
          <div key={s.label} className="bg-surface-1/40 backdrop-blur-xl border border-outline/10 rounded-2xl p-4 sm:p-5 text-center flex flex-col items-center">
            <div className="text-2xl sm:text-3xl mb-1.5">{s.icon}</div>
            <div className={`text-2xl sm:text-3xl font-extrabold leading-none ${s.accent}`}>{s.val}</div>
            <div className="text-[10px] sm:text-[11px] text-fg-muted uppercase tracking-wider font-bold mt-2">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        {/* Quick Actions */}
        <div className={cardClass}>
          <h2 className="text-base font-bold text-fg mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {quickActions.map(a => (
              <Link key={a.href} href={a.href} className="flex items-start gap-3 p-3 bg-surface-1/20 border border-outline/5 rounded-xl hover:bg-surface-1 hover:border-outline/10 transition-all group">
                <span className="text-lg mt-0.5 group-hover:scale-110 transition-transform">{a.icon}</span>
                <div>
                  <div className="text-[13px] font-bold text-fg">{a.label}</div>
                  <div className="text-[11px] text-fg-muted mt-0.5 leading-snug">{a.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Interview Status Breakdown */}
        <div className={cardClass}>
          <h2 className="text-base font-bold text-fg mb-4">Candidate Status Breakdown</h2>
          {Object.keys(statusBreakdown).length === 0 ? (
            <div className="text-fg-muted text-center py-8 text-sm">No candidates yet</div>
          ) : (
            <div className="flex flex-col gap-3">
              {Object.entries(statusBreakdown).map(([s, count]) => {
                const colorClass = statusColor(s);
                const pct = candidates.length ? Math.round((count / candidates.length) * 100) : 0;
                // Since inline background maps to tailwind classes now, we need a style for the dynamic bar color
                // using a simple generic color for the bar based on the prefix is straightforward
                const barColorClass = colorClass.includes("success") ? "bg-success" : colorClass.includes("danger") ? "bg-danger" : colorClass.includes("warning") ? "bg-warning" : colorClass.includes("info") ? "bg-info" : "bg-fg-muted";

                return (
                  <div key={s}>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${colorClass}`}>
                        {STATUS_LABEL[s] || s.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-fg-muted font-semibold">{count} · {pct}%</span>
                    </div>
                    <div className="h-1 bg-surface-sunken rounded-full overflow-hidden">
                      <div className={`h-full ${barColorClass} transition-all duration-500 ease-out`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Recent Candidates */}
        <div className={cardClass}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold text-fg m-0">Recent Candidates</h2>
            <Link href="/recruiter/candidates" className="text-xs text-accent font-semibold hover:underline">View all &rarr;</Link>
          </div>
          {recentCandidates.length === 0 ? (
            <div className="text-fg-muted text-center py-8 text-sm">
              No candidates yet. <Link href="/recruiter/add" className="text-accent underline">Add one</Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {recentCandidates.map(c => {
                const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
                const colorClass = statusColor(s);
                return (
                  <Link key={c._id} href={`/recruiter/candidates/${c._id}`} className="flex items-center justify-between p-3 bg-surface-1/20 border border-outline/5 rounded-xl hover:bg-surface-1 transition-all">
                    <div className="min-w-0 pr-3">
                      <div className="text-[13px] font-bold text-fg truncate">{c.name}</div>
                      <div className="text-[11px] text-fg-muted mt-0.5 truncate">
                        {c.roleName || "No role"}{c.currentCompany ? ` · ${c.currentCompany}` : ""}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${colorClass}`}>
                      {STATUS_LABEL[s] || s.replace(/_/g, " ")}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Weekly Top Performers */}
        <div className={cardClass}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold text-fg m-0">Top Performers (This Week)</h2>
            <Link href="/recruiter/history" className="text-xs text-accent font-semibold hover:underline">History &rarr;</Link>
          </div>
          {weeklyTop.length === 0 ? (
             <div className="text-fg-muted text-center py-8 text-sm">
              No scored interviews this week
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {weeklyTop.map((m, i) => {
                const score = m.scorecard?.overall_score || 0;
                const badgeClass = score >= 7 ? "bg-success/15 text-success" : score >= 5 ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger";
                
                return (
                  <div key={i} className="flex items-center gap-3 p-3 bg-surface-1/20 border border-outline/5 rounded-xl">
                    <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-extrabold ${i === 0 ? 'bg-warning/20 text-warning' : 'bg-surface-sunken text-fg-muted'}`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-fg truncate">
                        {m.candidateName}
                      </div>
                      <div className="text-[11px] text-fg-muted truncate">{m.roleName}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${badgeClass}`}>
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
        <div className={`${cardClass} mt-4 sm:mt-6`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold text-fg m-0">Upcoming Interviews</h2>
            <Link href="/recruiter/schedule" className="text-xs text-accent font-semibold hover:underline">Manage &rarr;</Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {scheduled.filter(s => s.status === "pending").slice(0, 5).map(iv => (
              <div key={iv._id} className="flex items-center justify-between p-3 sm:px-4 bg-info/10 border border-info/20 rounded-xl">
                <div>
                  <span className="text-[13px] font-bold text-fg">{iv.candidateName}</span>
                  <span className="text-xs text-fg-muted ml-2">{iv.roleName}</span>
                  {iv.attemptNumber === 2 && (
                    <span className="ml-2 bg-warning/15 text-warning px-1.5 py-0.5 rounded-full text-[10px] font-bold">Retry</span>
                  )}
                </div>
                <span className="text-xs text-info font-bold">
                  {new Date(iv.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} &middot; {new Date(iv.scheduledAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
