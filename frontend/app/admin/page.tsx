"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { logout, getUser } from "@/lib/api";
import ScorecardDetailModal, { ScorecardMeeting } from "@/components/ScorecardDetailModal";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";
const G = "rgba(255,255,255,";
function auth() { return `Bearer ${localStorage.getItem("token")}`; }

const card: React.CSSProperties = {
  background: `${G}0.05)`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.09)`, borderRadius: 14,
};
const inp: React.CSSProperties = {
  border: `1px solid ${G}0.12)`, borderRadius: 8, padding: "9px 12px", fontSize: 13,
  width: "100%", outline: "none", fontFamily: "inherit", background: `${G}0.07)`, color: "#f1f5f9", colorScheme: "dark",
};
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" };

interface Candidate {
  _id: string; name: string; email: string; roleName?: string; recruiterId?: string;
  recruiterName?: string; interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
}
interface ScheduledInterview {
  _id: string; candidateId?: string; candidateName: string; roleName: string; scheduledAt: number;
  status: string; recruiterId?: string; attemptNumber?: number; meetingUrl?: string; emailSent?: boolean;
}
type Meeting = ScorecardMeeting & { recruiterId?: string; recruiterName?: string; interviewStatus?: string; transcript?: { speaker: string; text: string }[]; };
type AdminTab = "weekly" | "candidates" | "scheduling" | "recruiters" | "analytics" | "settings";

interface AnalyticsData {
  summary: {
    totalCandidates: number; completedInterviews: number; inCooldown: number; noShowCount: number;
    averageScore: number; totalScoredMeetings: number; retryImprovedCount: number; totalRetried: number; improvementRate: number;
  };
  recruiterPerformance: { recruiterId: string; name: string; totalCandidates: number; completedInterviews: number; averageScore: number; successRate: number; }[];
  weeklyTop: { candidateName: string; roleName: string; score: number; recommendation: string; }[];
}

function ScoreChip({ score }: { score: number }) {
  const [bg, col] = score >= 7 ? ["rgba(52,211,153,0.15)", "#34d399"] : score >= 5 ? ["rgba(251,191,36,0.15)", "#fbbf24"] : ["rgba(248,113,113,0.15)", "#f87171"];
  return <span style={{ background: bg, color: col, padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>{score}/10</span>;
}

function StatusBadge({ status, cooldownUntil }: { status?: string; cooldownUntil?: number }) {
  const s = (status || "never_invited").replace(/\.\d+/g, "");
  const labelMap: Record<string, string> = {
    never_invited: "Not Invited", attempt_1_scheduled: "Interview 1 Sched.", attempt_2_scheduled: "Interview 2 Sched.",
    cooldown: cooldownUntil ? `Cooldown (${Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 86400000))}d)` : "Cooldown",
    locked: "Final / Locked", completed: "Completed", partial: "Partial", no_show: "No Show",
  };
  const colorMap: Record<string, [string, string]> = {
    never_invited: [`${G}0.06)`, "#94a3b8"], attempt_1_scheduled: ["rgba(59,130,246,0.12)", "#93c5fd"],
    attempt_2_scheduled: ["rgba(59,130,246,0.12)", "#93c5fd"], cooldown: ["rgba(245,158,11,0.12)", "#fbbf24"],
    locked: ["rgba(239,68,68,0.12)", "#f87171"], completed: ["rgba(16,185,129,0.12)", "#6ee7b7"],
    partial: ["rgba(234,179,8,0.12)", "#fde047"], no_show: ["rgba(245,158,11,0.12)", "#fbbf24"],
  };
  const label = labelMap[s] || s.replace(/_/g, " ");
  const [bg, col] = colorMap[s] || [`${G}0.06)`, "#94a3b8"];
  return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color: col }}>{label}</span>;
}

function SchedStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string, string]> = {
    pending:   ["rgba(59,130,246,0.12)", "#93c5fd", "Pending"],
    scheduled: ["rgba(59,130,246,0.12)", "#93c5fd", "Scheduled"],
    completed: ["rgba(16,185,129,0.12)", "#6ee7b7", "Completed"],
    cancelled: [`${G}0.06)`, "#94a3b8", "Cancelled"],
    failed:    ["rgba(239,68,68,0.12)", "#f87171", "Failed"],
  };
  const [bg, col, label] = map[status] || [`${G}0.06)`, "#94a3b8", status];
  return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color: col }}>{label}</span>;
}

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("weekly");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [scheduledInterviews, setScheduledInterviews] = useState<ScheduledInterview[]>([]);
  const [user, setUser] = useState<{ name?: string; email?: string; role?: string } | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterRecruiter, setFilterRecruiter] = useState("");
  const [schedSearch, setSchedSearch] = useState("");
  const [schedStatusFilter, setSchedStatusFilter] = useState("");
  const [modal, setModal] = useState<Meeting | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [usersList, setUsersList] = useState<{ _id: string; name: string; email: string; role: string }[]>([]);
  const [smtp, setSmtp] = useState({ host: "smtp.gmail.com", port: "587", user: "", pass: "" });
  const [googleConnected, setGoogleConnected] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState("");
  const [googleMsg, setGoogleMsg] = useState("Checking...");
  const [resetLoading, setResetLoading] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "/login"; return; }
    const u = getUser();
    if (u && u.role !== "admin") { window.location.href = "/recruiter"; return; }

    fetch(`${BASE}/api/auth/me`, { headers: { Authorization: auth() } })
      .then(r => {
        if (r.status === 401) { window.location.href = "/login"; return; }
        if (!r.ok) return;
        return r.json().then((d: { user?: { role?: string; name?: string; email?: string } }) => {
          if (!d.user || d.user.role !== "admin") { window.location.href = "/recruiter"; return; }
          setUser(d.user);
        });
      }).catch(() => {});

    Promise.all([
      fetch(`${BASE}/api/candidates`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setCandidates(d.candidates || [])),
      fetch(`${BASE}/api/meetings`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setMeetings(d.meetings || [])),
      fetch(`${BASE}/api/interviews/scheduled`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setScheduledInterviews(d.interviews || [])).catch(() => {}),
      fetch(`${BASE}/api/users`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setUsersList(d.users || [])).catch(() => {}),
      fetch(`${BASE}/api/settings/smtp`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => {
        if (d.smtp_host) setSmtp({ host: d.smtp_host, port: String(d.smtp_port || 587), user: d.smtp_user || "", pass: "" });
      }).catch(() => {}),
      fetch(`${BASE}/api/auth/google/status`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => {
        setGoogleConnected(d.connected);
        setGoogleMsg(d.connected ? `Connected as ${d.email || "Google Account"} ✓` : "Not connected");
      }).catch(() => { setGoogleMsg("Unknown"); }),
    ]);
  }, []);

  const recruiterMap: Record<string, string> = {};
  usersList.forEach(u => { recruiterMap[u._id] = u.name || u.email; });

  const weekStart = (() => { const now = new Date(); const d = new Date(now); d.setDate(now.getDate() - ((now.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const weeklyMeetings = meetings.filter(m => (m.createdAt || 0) >= weekStart && m.scorecard?.overall_score).sort((a, b) => (b.scorecard?.overall_score || 0) - (a.scorecard?.overall_score || 0));

  const filteredCandidates = candidates.filter(c => {
    if (searchQ && !(c.name || "").toLowerCase().includes(searchQ.toLowerCase()) && !(c.email || "").toLowerCase().includes(searchQ.toLowerCase())) return false;
    if (filterStatus && (c.interviewStatus || "never_invited") !== filterStatus) return false;
    if (filterRecruiter && c.recruiterId !== filterRecruiter) return false;
    return true;
  });

  const filteredScheduled = scheduledInterviews.filter(s => {
    if (schedSearch && !s.candidateName.toLowerCase().includes(schedSearch.toLowerCase()) && !s.roleName.toLowerCase().includes(schedSearch.toLowerCase())) return false;
    if (schedStatusFilter && s.status !== schedStatusFilter) return false;
    return true;
  }).sort((a, b) => b.scheduledAt - a.scheduledAt);

  const recruiterStats: Record<string, { name: string; total: number; done: number; avgScore: number; scores: number[] }> = {};
  candidates.forEach(c => {
    const rid = c.recruiterId || "unknown";
    if (!recruiterStats[rid]) recruiterStats[rid] = { name: recruiterMap[rid] || "Unknown", total: 0, done: 0, avgScore: 0, scores: [] };
    recruiterStats[rid].total++;
    if (["locked", "completed"].includes(c.interviewStatus || "")) recruiterStats[rid].done++;
  });
  meetings.forEach(m => {
    const rid = m.recruiterId || "unknown";
    if (recruiterStats[rid] && m.scorecard?.overall_score) recruiterStats[rid].scores.push(m.scorecard.overall_score);
  });
  Object.values(recruiterStats).forEach(r => { if (r.scores.length) r.avgScore = parseFloat((r.scores.reduce((a, b) => a + b, 0) / r.scores.length).toFixed(1)); });

  async function refreshCandidates() {
    const r = await fetch(`${BASE}/api/candidates`, { headers: { Authorization: auth() } });
    const d = await r.json();
    setCandidates(d.candidates || []);
  }
  async function refreshScheduled() {
    try { const r = await fetch(`${BASE}/api/interviews/scheduled`, { headers: { Authorization: auth() } }); const d = await r.json(); setScheduledInterviews(d.interviews || []); } catch { /* ignore */ }
  }

  async function resetCandidate(candidateId: string, name: string) {
    if (!confirm(`Reset interview state for ${name}?\n\nThis will:\n• Clear cooldown / locked status\n• Reset attempt count to 0\n• Cancel any pending scheduled interviews`)) return;
    setResetLoading(candidateId); setResetMsg(null);
    try {
      const res = await fetch(`${BASE}/api/admin/candidates/${candidateId}/reset`, { method: "POST", headers: { Authorization: auth() } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Reset failed");
      setResetMsg({ id: candidateId, text: `Reset done. ${d.cancelled_interviews} interview(s) cancelled.`, ok: true });
      await Promise.all([refreshCandidates(), refreshScheduled()]);
    } catch (e) {
      setResetMsg({ id: candidateId, text: e instanceof Error ? e.message : "Reset failed", ok: false });
    } finally { setResetLoading(null); setTimeout(() => setResetMsg(null), 4000); }
  }

  async function cancelInterview(interviewId: string, candidateName: string) {
    if (!confirm(`Cancel scheduled interview for ${candidateName}?`)) return;
    setCancelLoading(interviewId);
    try {
      const res = await fetch(`${BASE}/api/interviews/${interviewId}/cancel`, { method: "POST", headers: { Authorization: auth() } });
      if (!res.ok) throw new Error("Cancel failed");
      await Promise.all([refreshScheduled(), refreshCandidates()]);
    } catch (e) { alert(e instanceof Error ? e.message : "Cancel failed"); }
    finally { setCancelLoading(null); }
  }

  async function saveSmtp(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch(`${BASE}/api/settings/smtp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth() }, body: JSON.stringify({ smtp_host: smtp.host, smtp_port: parseInt(smtp.port), smtp_user: smtp.user, smtp_pass: smtp.pass }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setSmtpMsg("Saved ✓");
    } catch (err: unknown) { setSmtpMsg(err instanceof Error ? err.message : "Error"); }
  }

  function loadAnalytics() {
    fetch(`${BASE}/api/admin/analytics`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setAnalytics(d)).catch(() => {});
  }

  const uniqueRecruiters = [...new Set(candidates.map(c => c.recruiterId).filter(Boolean))] as string[];
  const pendingCount = scheduledInterviews.filter(s => !["completed", "cancelled"].includes(s.status)).length;

  const tabs: { id: AdminTab; label: string }[] = [
    { id: "weekly", label: "Weekly Top" }, { id: "candidates", label: "All Candidates" },
    { id: "scheduling", label: "Scheduling" }, { id: "recruiters", label: "Recruiters" },
    { id: "analytics", label: "Analytics" }, { id: "settings", label: "Settings" },
  ];

  const thStyle: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b", background: `${G}0.03)`, borderBottom: `2px solid ${G}0.09)` };
  const tdStyle: React.CSSProperties = { padding: "12px", borderBottom: `1px solid ${G}0.05)`, fontSize: 13 };

  return (
    <div style={{ minHeight: "100vh", background: "#07070f", backgroundImage: "radial-gradient(ellipse 80% 60% at 5% 10%, rgba(139,92,246,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 95% 90%, rgba(99,102,241,0.08) 0%, transparent 60%)", backgroundAttachment: "fixed" }}>

      {/* Header */}
      <header style={{ background: "rgba(8,8,17,0.88)", backdropFilter: "blur(24px)", borderBottom: `1px solid ${G}0.08)`, padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={30} height={30} style={{ objectFit: "contain" }} />
          <span style={{ fontSize: 18, fontWeight: 800, background: "linear-gradient(135deg,#a78bfa,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>RecruitX</span>
          <span style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Admin</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{user?.name}</span>
          <button onClick={logout} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", color: "#f87171", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Logout</button>
        </div>
      </header>

      {/* Nav tabs */}
      <div style={{ background: "rgba(8,8,17,0.7)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${G}0.07)`, padding: "0 24px", display: "flex", gap: 2 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "10px 18px", cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? "#c4b5fd" : "#94a3b8", border: "none", background: "none", borderBottom: tab === t.id ? "2px solid #8b5cf6" : "2px solid transparent", transition: "all .2s", position: "relative" }}>
            {t.label}
            {t.id === "scheduling" && pendingCount > 0 && (
              <span style={{ position: "absolute", top: 6, right: 2, background: "#dc2626", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      <main style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>

        {/* ── Weekly Top ── */}
        {tab === "weekly" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", margin: "0 0 20px" }}>Weekly Top Candidates</h2>
            {weeklyMeetings.length === 0 ? (
              <div style={{ ...card, padding: 60, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                <p style={{ color: "#94a3b8", margin: 0, fontSize: 14 }}>No completed interviews this week yet.</p>
              </div>
            ) : (
              <>
                {/* Top banner */}
                <div style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", borderRadius: 16, padding: 28, marginBottom: 24, border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(124,58,237,0.25)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <div>
                      <p style={{ margin: "0 0 4px", fontSize: 11, opacity: .8, textTransform: "uppercase", letterSpacing: ".1em" }}>Top Candidate This Week</p>
                      <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800, color: "#fff" }}>{weeklyMeetings[0].candidateName}</h2>
                      <p style={{ margin: 0, fontSize: 14, opacity: .85, color: "#fff" }}>{weeklyMeetings[0].roleName || "Interview"}</p>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ width: 88, height: 88, borderRadius: "50%", background: "rgba(255,255,255,.2)", border: "2px solid rgba(255,255,255,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800, color: "#fff" }}>{weeklyMeetings[0].scorecard?.overall_score}</div>
                      <p style={{ margin: "6px 0 0", fontSize: 11, opacity: .7, color: "#fff" }}>out of 10</p>
                    </div>
                  </div>
                  {weeklyMeetings[0].scorecard?.summary && <p style={{ margin: "16px 0 0", opacity: .85, fontStyle: "italic", lineHeight: 1.6, color: "#fff" }}>&quot;{weeklyMeetings[0].scorecard.summary}&quot;</p>}
                </div>

                <div style={{ ...card, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Rank","Name","Role","Recruiter","Score","Recommendation","Actions"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {weeklyMeetings.map((m, i) => (
                        <tr key={m._id}>
                          <td style={{ ...tdStyle, fontWeight: 800, color: "#a78bfa" }}>#{i + 1}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: "#f1f5f9" }}>{m.candidateName}</td>
                          <td style={{ ...tdStyle, color: "#94a3b8" }}>{m.roleName || "—"}</td>
                          <td style={{ ...tdStyle, color: "#64748b" }}>{m.recruiterId ? recruiterMap[m.recruiterId] || m.recruiterId.slice(-6) : "—"}</td>
                          <td style={tdStyle}>{m.scorecard?.overall_score ? <ScoreChip score={m.scorecard.overall_score} /> : "—"}</td>
                          <td style={{ ...tdStyle, color: "#94a3b8" }}>{m.scorecard?.recommendation || "—"}</td>
                          <td style={tdStyle}><button onClick={() => setModal(m)} style={{ background: `${G}0.08)`, color: "#e2e8f0", border: `1px solid ${G}0.12)`, padding: "5px 12px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>View</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── All Candidates ── */}
        {tab === "candidates" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>All Candidates</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search name / email..." style={{ ...inp, width: 220 }} />
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, width: 160 }}>
                  <option value="">All statuses</option>
                  <option value="never_invited">Not Invited</option>
                  <option value="attempt_1_scheduled">Interview 1 Sched.</option>
                  <option value="cooldown">Cooldown</option>
                  <option value="attempt_2_scheduled">Interview 2 Sched.</option>
                  <option value="locked">Locked</option>
                  <option value="completed">Completed</option>
                </select>
                <select value={filterRecruiter} onChange={e => setFilterRecruiter(e.target.value)} style={{ ...inp, width: 180 }}>
                  <option value="">All recruiters</option>
                  {uniqueRecruiters.map(rid => <option key={rid} value={rid}>{recruiterMap[rid] || rid.slice(-6)}</option>)}
                </select>
              </div>
            </div>

            {resetMsg && (
              <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: resetMsg.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: resetMsg.ok ? "#34d399" : "#f87171", border: `1px solid ${resetMsg.ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                {resetMsg.text}
              </div>
            )}

            <div style={{ ...card, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Name","Email","Role","Recruiter","Attempts","Status","Score","Actions"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {filteredCandidates.length === 0
                    ? <tr><td colSpan={8} style={{ textAlign: "center", color: "#64748b", padding: 40 }}>No candidates match the filter</td></tr>
                    : filteredCandidates.map(c => {
                      const cMeetings = meetings.filter(m => m.candidateName === c.name && m.scorecard?.overall_score);
                      const bestScore = cMeetings.length ? Math.max(...cMeetings.map(m => m.scorecard!.overall_score!)) : null;
                      const canReset = !["never_invited"].includes(c.interviewStatus || "never_invited");
                      return (
                        <tr key={c._id}>
                          <td style={{ ...tdStyle, fontWeight: 700, color: "#f1f5f9" }}>{c.name}</td>
                          <td style={{ ...tdStyle, color: "#64748b" }}>{c.email}</td>
                          <td style={{ ...tdStyle, color: "#e2e8f0" }}>{c.roleName || "—"}</td>
                          <td style={{ ...tdStyle, color: "#64748b" }}>{c.recruiterId ? recruiterMap[c.recruiterId] || c.recruiterId.slice(-6) : "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>{c.attemptCount || 0}/2</td>
                          <td style={tdStyle}><StatusBadge status={c.interviewStatus} cooldownUntil={c.cooldownUntil} /></td>
                          <td style={tdStyle}>{bestScore ? <ScoreChip score={bestScore} /> : <span style={{ color: "#64748b" }}>—</span>}</td>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", gap: 6 }}>
                              {cMeetings.length > 0 && (
                                <button onClick={() => setModal(cMeetings[0])} style={{ background: `${G}0.07)`, color: "#e2e8f0", border: `1px solid ${G}0.12)`, padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Scorecard</button>
                              )}
                              {canReset && (
                                <button onClick={() => resetCandidate(c._id, c.name)} disabled={resetLoading === c._id} style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.18)", padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: resetLoading === c._id ? "not-allowed" : "pointer", opacity: resetLoading === c._id ? 0.6 : 1 }}>
                                  {resetLoading === c._id ? "Resetting..." : "Reset"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: "#64748b", marginTop: 10 }}>Reset clears cooldown/lock and resets attempt count. Admin only.</p>
          </div>
        )}

        {/* ── Scheduling ── */}
        {tab === "scheduling" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", margin: "0 0 4px" }}>Scheduled Interviews</h2>
                <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>{pendingCount} pending · {scheduledInterviews.length} total</p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={schedSearch} onChange={e => setSchedSearch(e.target.value)} placeholder="Search candidate / role..." style={{ ...inp, width: 220 }} />
                <select value={schedStatusFilter} onChange={e => setSchedStatusFilter(e.target.value)} style={{ ...inp, width: 160 }}>
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="failed">Failed</option>
                </select>
                <button onClick={refreshScheduled} style={{ padding: "9px 14px", background: `${G}0.07)`, border: `1px solid ${G}0.12)`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#e2e8f0" }}>Refresh</button>
              </div>
            </div>

            <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#93c5fd" }}>
              <strong>Admin controls:</strong> Cancel any pending interview below. Use <strong>Reset</strong> in All Candidates to fully reset a candidate.
            </div>

            {filteredScheduled.length === 0 ? (
              <div style={{ ...card, padding: 60, textAlign: "center" }}>
                <p style={{ color: "#64748b", margin: 0 }}>No scheduled interviews found.</p>
              </div>
            ) : (
              <div style={{ ...card, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Candidate","Role","Scheduled At","Attempt","Recruiter","Status","Actions"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {filteredScheduled.map(s => {
                      const isPending = !["completed", "cancelled"].includes(s.status);
                      const dt = new Date(s.scheduledAt);
                      const isPast = dt < new Date();
                      return (
                        <tr key={s._id}>
                          <td style={{ ...tdStyle, fontWeight: 700, color: "#f1f5f9" }}>{s.candidateName}</td>
                          <td style={{ ...tdStyle, color: "#94a3b8" }}>{s.roleName || "—"}</td>
                          <td style={tdStyle}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: isPast && isPending ? "#f87171" : "#e2e8f0" }}>
                              {dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                              {isPast && isPending && <span style={{ marginLeft: 6, color: "#f87171", fontWeight: 700 }}>Overdue</span>}
                            </div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <span style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>#{s.attemptNumber || 1}</span>
                          </td>
                          <td style={{ ...tdStyle, color: "#64748b" }}>{s.recruiterId ? recruiterMap[s.recruiterId] || s.recruiterId.slice(-6) : "—"}</td>
                          <td style={tdStyle}><SchedStatusBadge status={s.status} /></td>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", gap: 6 }}>
                              {s.meetingUrl && (
                                <a href={s.meetingUrl} target="_blank" rel="noreferrer" style={{ background: "rgba(59,130,246,0.10)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.2)", padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, textDecoration: "none" }}>Meet Link</a>
                              )}
                              {isPending && (
                                <button onClick={() => cancelInterview(s._id, s.candidateName)} disabled={cancelLoading === s._id} style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.18)", padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: cancelLoading === s._id ? "not-allowed" : "pointer", opacity: cancelLoading === s._id ? 0.6 : 1 }}>
                                  {cancelLoading === s._id ? "Cancelling..." : "Cancel"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Recruiters ── */}
        {tab === "recruiters" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 20 }}>Recruiter Overview</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px,1fr))", gap: 16 }}>
              {Object.entries(recruiterStats).map(([rid, r]) => (
                <div key={rid} style={{ ...card, padding: 20 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px", color: "#e2e8f0" }}>{r.name}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[["Candidates", r.total, "#a78bfa"], ["Completed", r.done, "#60a5fa"], ["Avg Score", r.avgScore || "—", "#fbbf24"]].map(([label, val, col]) => (
                      <div key={String(label)} style={{ textAlign: "center", padding: "12px 8px", background: `${G}0.04)`, borderRadius: 10, border: `1px solid ${G}0.07)` }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: String(col) }}>{String(val)}</div>
                        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 2 }}>{String(label)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {Object.keys(recruiterStats).length === 0 && (
                <div style={{ ...card, padding: 60, textAlign: "center", gridColumn: "1/-1" }}>
                  <p style={{ color: "#64748b", margin: 0 }}>No recruiter data yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Analytics ── */}
        {tab === "analytics" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Platform Analytics</h2>
              <button onClick={loadAnalytics} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {analytics ? "↻ Refresh" : "Load Analytics"}
              </button>
            </div>
            {!analytics ? (
              <div style={{ ...card, padding: 60, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                <p style={{ color: "#94a3b8", margin: 0 }}>Click &quot;Load Analytics&quot; to fetch real-time platform stats.</p>
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
                  {[
                    { label: "Total Candidates",     val: analytics.summary.totalCandidates,      col: "#a78bfa" },
                    { label: "Completed Interviews", val: analytics.summary.completedInterviews,  col: "#60a5fa" },
                    { label: "In Cooldown",          val: analytics.summary.inCooldown,            col: "#fbbf24" },
                    { label: "No-Show Count",        val: analytics.summary.noShowCount,           col: "#f87171" },
                    { label: "Avg Score",            val: analytics.summary.averageScore || "—",   col: "#34d399" },
                    { label: "Total Retried",        val: analytics.summary.totalRetried,          col: "#38bdf8" },
                    { label: "Improved on Retry",    val: analytics.summary.retryImprovedCount,    col: "#34d399" },
                    { label: "Improvement Rate",     val: `${analytics.summary.improvementRate}%`, col: "#a78bfa" },
                  ].map(k => (
                    <div key={k.label} style={{ ...card, padding: "16px 18px" }}>
                      <div style={{ fontSize: 26, fontWeight: 800, color: k.col }}>{String(k.val)}</div>
                      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 4 }}>{k.label}</div>
                    </div>
                  ))}
                </div>

                {analytics.weeklyTop.length > 0 && (
                  <div style={{ ...card, padding: 24, marginBottom: 20, overflow: "hidden" }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px" }}>Weekly Top Candidates</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Rank","Candidate","Role","Score","Recommendation"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                      <tbody>
                        {analytics.weeklyTop.map((c, i) => (
                          <tr key={i}>
                            <td style={{ ...tdStyle, fontWeight: 800, color: "#a78bfa" }}>#{i + 1}</td>
                            <td style={{ ...tdStyle, fontWeight: 600, color: "#f1f5f9" }}>{c.candidateName}</td>
                            <td style={{ ...tdStyle, color: "#94a3b8" }}>{c.roleName}</td>
                            <td style={tdStyle}><ScoreChip score={c.score} /></td>
                            <td style={{ ...tdStyle, color: "#94a3b8" }}>{c.recommendation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {analytics.recruiterPerformance.length > 0 && (
                  <div style={{ ...card, padding: 24, overflow: "hidden" }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px" }}>Recruiter Performance</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Recruiter","Candidates","Completed","Avg Score","Success Rate"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                      <tbody>
                        {analytics.recruiterPerformance.map(r => (
                          <tr key={r.recruiterId}>
                            <td style={{ ...tdStyle, fontWeight: 600, color: "#f1f5f9" }}>{r.name}</td>
                            <td style={{ ...tdStyle, color: "#94a3b8" }}>{r.totalCandidates}</td>
                            <td style={{ ...tdStyle, color: "#94a3b8" }}>{r.completedInterviews}</td>
                            <td style={tdStyle}>{r.averageScore ? <ScoreChip score={r.averageScore} /> : "—"}</td>
                            <td style={tdStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ flex: 1, height: 5, background: `${G}0.08)`, borderRadius: 3 }}>
                                  <div style={{ height: 5, background: "#8b5cf6", borderRadius: 3, width: `${r.successRate}%` }} />
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", minWidth: 36 }}>{r.successRate}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Settings ── */}
        {tab === "settings" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 24 }}>System Settings</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 900 }}>
              <div style={{ ...card, padding: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 14 }}>Google Account</h3>
                <div style={{ marginBottom: 14, fontSize: 13, color: googleConnected ? "#34d399" : "#94a3b8", fontWeight: 600 }}>{googleMsg}</div>
                <button onClick={async () => {
                  try {
                    const res = await fetch(`${BASE}/api/auth/google`, { headers: { Authorization: auth() } });
                    const d = await res.json();
                    if (d.auth_url) window.location.href = d.auth_url;
                    else setGoogleMsg(d.detail || "Failed");
                  } catch { setGoogleMsg("Could not reach backend"); }
                }} style={{ padding: "10px 22px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Connect Google Account
                </button>
              </div>
              <div style={{ ...card, padding: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 14 }}>SMTP Email</h3>
                <form onSubmit={saveSmtp}>
                  {[["SMTP Host", "smtp.gmail.com", "host", "text"], ["Port", "587", "port", "number"], ["Email Address", "you@gmail.com", "user", "email"], ["App Password", "", "pass", "password"]].map(([label, ph, key, type]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <label style={lbl}>{label}</label>
                      <input type={type} placeholder={ph} value={(smtp as Record<string, string>)[key]} onChange={e => setSmtp(p => ({ ...p, [key]: e.target.value }))} style={inp} />
                    </div>
                  ))}
                  {smtpMsg && <div style={{ marginBottom: 10, fontSize: 12, padding: "8px 12px", borderRadius: 7, background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>{smtpMsg}</div>}
                  <button type="submit" style={{ width: "100%", padding: "10px 22px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save SMTP</button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {modal && <ScorecardDetailModal meetings={[modal]} onClose={() => setModal(null)} dashboardUrl="/admin" />}
    </div>
  );
}
