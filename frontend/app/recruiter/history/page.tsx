"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import ScorecardDetailModal, { ScorecardMeeting } from "@/components/ScorecardDetailModal";

const G = "rgba(255,255,255,";

const card: React.CSSProperties = {
  background: `${G}0.05)`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.09)`, borderRadius: 14,
};

// ── Interfaces ────────────────────────────────────────────────────────────
type InterviewStatus = "completed" | "partial" | "no_show" | string;

interface Meeting extends ScorecardMeeting {
  meetingUrl?: string;
  transcript?: { speaker: string; text: string }[];
  botAudioUrl?: string;
  candidateAudioUrl?: string;
  interviewStatus?: InterviewStatus;
  createdAt?: number;
}

// ── Status config ─────────────────────────────────────────────────────────
function statusStyle(s: InterviewStatus): [string, string, string] {
  const m: Record<string, [string, string, string]> = {
    completed: ["rgba(16,185,129,0.15)", "#6ee7b7", "Completed"],
    partial:   ["rgba(234,179,8,0.15)",  "#fde047", "Partial"],
    no_show:   ["rgba(245,158,11,0.15)", "#fbbf24", "No Show"],
    failed:    ["rgba(239,68,68,0.15)",  "#fca5a5", "Failed"],
  };
  return m[s] || [`${G}0.06)`, "#94a3b8", s.replace(/_/g, " ")];
}

function scoreColor(score: number): [string, string] {
  if (score >= 7) return ["rgba(52,211,153,0.15)", "#34d399"];
  if (score >= 5) return ["rgba(251,191,36,0.15)", "#fbbf24"];
  return ["rgba(248,113,113,0.15)", "#f87171"];
}

// Single color string (for gauge / bars)
function sc(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#8b5cf6";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

function recStyle(rec: string): { label: string; color: string } {
  const r = rec.toUpperCase();
  if (r.includes("STRONG HIRE")) return { label: "Strong Hire", color: "#22c55e" };
  if (r === "HIRE")              return { label: "Hire",        color: "#8b5cf6" };
  if (r === "MAYBE")             return { label: "Maybe",       color: "#f59e0b" };
  return                                { label: "No Hire",     color: "#ef4444" };
}

// Conic-gradient gauge
function ScoreGaugeSmall({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score / 10));
  const col = sc(score);
  return (
    <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `conic-gradient(${col} ${pct * 360}deg, rgba(255,255,255,0.07) 0deg)` }} />
      <div style={{ position: "absolute", inset: 5, borderRadius: "50%", background: "rgba(8,8,17,0.98)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1 }}>{score.toFixed(1)}</span>
        <span style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>/ 10</span>
      </div>
    </div>
  );
}

// Score bar with pass-threshold tick
function ScoreBarInline({ score }: { score: number }) {
  const col = sc(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: "rgba(255,255,255,0.07)", position: "relative", overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 99, background: col, width: `${(score / 10) * 100}%`, transition: "width .4s ease" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: "60%", width: 1, background: "rgba(255,255,255,0.25)" }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 800, color: col, minWidth: 20, textAlign: "right" }}>{score}</span>
    </div>
  );
}

// ── Sub components ────────────────────────────────────────────────────────
function TranscriptView({ transcript }: { transcript: { speaker: string; text: string }[] }) {
  const isBot = (s: string) => s === "AI" || s.toLowerCase().includes("recruit");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 400, overflowY: "auto", padding: "4px 0" }}>
      {transcript.length === 0 ? (
        <p style={{ color: "#64748b", textAlign: "center", padding: "20px 0", fontSize: 13 }}>No transcript available</p>
      ) : transcript.map((t, i) => {
        const bot = isBot(t.speaker);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: bot ? "flex-end" : "flex-start" }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: bot ? "#a78bfa" : "#60a5fa", marginBottom: 3 }}>
              {bot ? "AI Bot" : t.speaker}
            </span>
            <div style={{
              maxWidth: "78%", padding: "9px 13px", fontSize: 13, lineHeight: 1.6,
              borderRadius: bot ? "13px 13px 4px 13px" : "13px 13px 13px 4px",
              background: bot ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.12)",
              color: bot ? "#c4b5fd" : "#93c5fd",
              border: `1px solid ${bot ? "rgba(139,92,246,0.2)" : "rgba(59,130,246,0.15)"}`,
            }}>
              {t.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function HistoryPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [scoreFilter, setScoreFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"scorecard" | "transcript" | "recording">("scorecard");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<boolean>(false);

  useEffect(() => {
    api("/api/meetings").then(r => r.json()).then(d => {
      const all: Meeting[] = (d.meetings || []).sort((a: Meeting, b: Meeting) =>
        (b.createdAt || 0) - (a.createdAt || 0)
      );
      setMeetings(all);
    }).finally(() => setLoading(false));
  }, []);

  // Filters
  const now = Date.now();
  const DAY = 86400000;
  const filtered = meetings.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q || (m.candidateName || "").toLowerCase().includes(q)
      || (m.roleName || "").toLowerCase().includes(q);

    const matchStatus = !statusFilter || m.interviewStatus === statusFilter;

    const score = m.scorecard?.overall_score || 0;
    const matchScore = !scoreFilter ||
      (scoreFilter === "high" && score >= 7) ||
      (scoreFilter === "mid" && score >= 5 && score < 7) ||
      (scoreFilter === "low" && score > 0 && score < 5) ||
      (scoreFilter === "unscored" && !score);

    const created = m.createdAt || 0;
    const matchDate = !dateFilter ||
      (dateFilter === "today" && now - created < DAY) ||
      (dateFilter === "7d" && now - created < 7 * DAY) ||
      (dateFilter === "30d" && now - created < 30 * DAY);

    return matchSearch && matchStatus && matchScore && matchDate;
  });

  const stats = {
    total: meetings.length,
    completed: meetings.filter(m => m.interviewStatus === "completed").length,
    scored: meetings.filter(m => m.scorecard?.overall_score).length,
    avgScore: (() => {
      const s = meetings.filter(m => m.scorecard?.overall_score);
      return s.length ? (s.reduce((a, m) => a + (m.scorecard?.overall_score || 0), 0) / s.length).toFixed(1) : "—";
    })(),
  };

  function selectMeeting(m: Meeting) {
    setSelected(m);
    setActiveTab("scorecard");
    setModal(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)", gap: 16 }}>
      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {[
          { label: "Total Interviews", val: stats.total, col: "#a78bfa" },
          { label: "Completed", val: stats.completed, col: "#34d399" },
          { label: "Scored", val: stats.scored, col: "#fbbf24" },
          { label: "Avg Score", val: stats.avgScore, col: "#f97316" },
        ].map(s => (
          <div key={s.label} style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: s.col }}>{s.val}</span>
            <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Two-panel body */}
      <div style={{ flex: 1, display: "flex", gap: 16, overflow: "hidden" }}>

        {/* ── Left: Interview List ── */}
        <div style={{
          width: 340, flexShrink: 0, display: "flex", flexDirection: "column",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14, overflow: "hidden",
        }}>
          {/* Filters */}
          <div style={{ padding: "14px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
                History <span style={{ color: "#64748b", fontWeight: 400, fontSize: 12 }}>({filtered.length})</span>
              </span>
            </div>
            <input
              style={{
                width: "100%", padding: "8px 11px", fontSize: 12,
                border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, outline: "none",
                background: "rgba(255,255,255,0.07)", color: "#f1f5f9", fontFamily: "inherit",
              }}
              placeholder="Search candidate or role…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { label: "All", val: "" },
                { label: "Completed", val: "completed" },
                { label: "Partial", val: "partial" },
                { label: "No Show", val: "no_show" },
              ].map(opt => (
                <button key={opt.val} onClick={() => setStatusFilter(opt.val)} style={{
                  padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: "pointer", border: "1px solid",
                  background: statusFilter === opt.val ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.04)",
                  color: statusFilter === opt.val ? "#c4b5fd" : "#94a3b8",
                  borderColor: statusFilter === opt.val ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.08)",
                }}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={scoreFilter}
                onChange={e => setScoreFilter(e.target.value)}
                style={{ flex: 1, padding: "6px 8px", fontSize: 11, border: "1px solid rgba(255,255,255,0.10)", borderRadius: 7, outline: "none", background: "rgba(255,255,255,0.07)", color: "#f1f5f9" }}
              >
                <option value="">All scores</option>
                <option value="high">High (7-10)</option>
                <option value="mid">Mid (5-6)</option>
                <option value="low">Low (1-4)</option>
                <option value="unscored">Unscored</option>
              </select>
              <select
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ flex: 1, padding: "6px 8px", fontSize: 11, border: "1px solid rgba(255,255,255,0.10)", borderRadius: 7, outline: "none", background: "rgba(255,255,255,0.07)", color: "#f1f5f9" }}
              >
                <option value="">All time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </div>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 13 }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 13 }}>
                {search || statusFilter || scoreFilter || dateFilter ? "No matches" : "No interviews yet"}
              </div>
            ) : filtered.map((m, i) => {
              const score = m.scorecard?.overall_score;
              const [statBg, statCol, statLabel] = statusStyle(m.interviewStatus || "completed");
              const [scoreBg, scoreCol] = score ? scoreColor(score) : [`${G}0.05)`, "#64748b"];
              const isSelected = selected === m || (selected?.candidateName === m.candidateName && selected?.attemptNumber === m.attemptNumber);
              return (
                <button
                  key={i}
                  onClick={() => selectMeeting(m)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "12px 14px",
                    background: isSelected ? "rgba(139,92,246,0.10)" : "transparent",
                    borderLeft: `3px solid ${isSelected ? "#8b5cf6" : "transparent"}`,
                    border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer", transition: "all .12s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "#c4b5fd" : "#e2e8f0" }}>
                      {m.candidateName}
                    </span>
                    {score ? (
                      <span style={{ background: scoreBg, color: scoreCol, padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 800, flexShrink: 0, marginLeft: 6 }}>
                        {score}/10
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {m.roleName || "Interview"}{m.attemptNumber ? ` · #${m.attemptNumber}` : ""}
                    </span>
                    <span style={{ background: statBg, color: statCol, padding: "1px 7px", borderRadius: 20, fontSize: 9, fontWeight: 700 }}>
                      {statLabel}
                    </span>
                  </div>
                  {m.createdAt && (
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                      {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: Detail Panel ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!selected ? (
            <div style={{ ...card, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", margin: "0 0 8px" }}>Select an Interview</h2>
              <p style={{ color: "#64748b", fontSize: 13 }}>Click any interview in the list to view details, scorecard, and transcript</p>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Detail header */}
              <div style={{ ...card, padding: "16px 20px", marginBottom: 14, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9", margin: "0 0 4px" }}>{selected.candidateName}</h2>
                    <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
                      {selected.roleName || "Interview"}
                      {selected.attemptNumber ? ` · Attempt #${selected.attemptNumber}` : ""}
                      {selected.createdAt ? ` · ${new Date(selected.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {(() => {
                      const [bg, col, label] = statusStyle(selected.interviewStatus || "");
                      return <span style={{ background: bg, color: col, padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{label}</span>;
                    })()}
                    {selected.scorecard?.overall_score && (() => {
                      const [bg, col] = scoreColor(selected.scorecard.overall_score);
                      return (
                        <span style={{ background: bg, color: col, padding: "3px 11px", borderRadius: 20, fontSize: 13, fontWeight: 800 }}>
                          {selected.scorecard.overall_score}/10
                        </span>
                      );
                    })()}
                    {selected.scorecard?.overall_score && (
                      <button
                        onClick={() => setModal(true)}
                        style={{ padding: "6px 14px", background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                      >
                        Full Scorecard
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 14, flexShrink: 0 }}>
                {(["scorecard", "transcript", "recording"] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    padding: "8px 16px", fontSize: 13, fontWeight: 600, border: "none",
                    background: "none", cursor: "pointer",
                    borderBottom: activeTab === tab ? "2px solid #8b5cf6" : "2px solid transparent",
                    color: activeTab === tab ? "#c4b5fd" : "#94a3b8",
                    textTransform: "capitalize",
                  }}>
                    {tab === "scorecard" ? "Scorecard" : tab === "transcript" ? "Transcript" : "Recording"}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: "auto" }}>

                {/* ── Scorecard Tab (caller-x style) ── */}
                {activeTab === "scorecard" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {!selected.scorecard?.overall_score ? (
                      <div style={{ ...card, padding: 40, textAlign: "center" }}>
                        <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                        <p style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600, margin: "0 0 6px" }}>No scorecard available</p>
                        <p style={{ color: "#64748b", fontSize: 12 }}>Generated after the AI interview completes</p>
                      </div>
                    ) : (() => {
                      const s = selected.scorecard!;
                      const rec = s.recommendation ? recStyle(s.recommendation) : null;
                      const skillsList = s.skill_breakdown?.length
                        ? s.skill_breakdown
                        : s.skill_scores
                        ? Object.entries(s.skill_scores).map(([name, score]) => ({ name, score, description: undefined }))
                        : [];
                      const sorted = [...skillsList].sort((a, b) => b.score - a.score);
                      const topS = s.top_strengths?.length ? s.top_strengths : sorted.slice(0, 2).map(x => ({ name: x.name, score: x.score }));
                      const topG = s.top_gaps?.length ? s.top_gaps : sorted.slice(-2).reverse().map(x => ({ name: x.name, score: x.score }));
                      const greenFlags = [...(s.green_flags || []), ...(s.strengths || [])];
                      const redFlags = s.red_flags || [];
                      const improvements = s.areas_for_improvement || [];

                      return (
                        <>
                          {/* Hero: gauge + name + recommendation + summary */}
                          <div style={{ ...card, padding: 20 }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                              <ScoreGaugeSmall score={s.overall_score!} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                                  <span style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9" }}>{selected.candidateName}</span>
                                  {rec && <span style={{ background: `${rec.color}18`, color: rec.color, border: `1px solid ${rec.color}30`, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{rec.label}</span>}
                                </div>
                                {s.summary && (
                                  <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, borderLeft: `2px solid ${rec?.color || "#8b5cf6"}`, paddingLeft: 10, fontStyle: "italic" }}>
                                    {s.summary}
                                  </p>
                                )}
                              </div>
                            </div>
                            {/* Snapshot */}
                            {(topS.length > 0 || topG.length > 0) && (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                                {topS.length > 0 && (
                                  <div>
                                    <p style={{ margin: "0 0 8px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b" }}>Top Strengths</p>
                                    {topS.map((x, i) => (
                                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 12 }}>
                                        <span style={{ color: "#e2e8f0" }}>{x.name}</span>
                                        <span style={{ fontWeight: 800, color: sc(x.score) }}>{x.score}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {topG.length > 0 && (
                                  <div>
                                    <p style={{ margin: "0 0 8px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b" }}>Top Gaps</p>
                                    {topG.map((x, i) => (
                                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 12 }}>
                                        <span style={{ color: "#e2e8f0" }}>{x.name}</span>
                                        <span style={{ fontWeight: 800, color: sc(x.score) }}>{x.score}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Green / Red Flags */}
                          {(greenFlags.length > 0 || redFlags.length > 0) && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                              {greenFlags.length > 0 && (
                                <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 12, padding: 16 }}>
                                  <h4 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: "#22c55e", display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e" }} />Green Flags
                                  </h4>
                                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                                    {greenFlags.map((f, i) => <li key={i} style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 6 }}><span style={{ color: "#22c55e" }}>+</span>{f}</li>)}
                                  </ul>
                                </div>
                              )}
                              {redFlags.length > 0 && (
                                <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 12, padding: 16 }}>
                                  <h4 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: "#ef4444", display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444" }} />Red Flags
                                  </h4>
                                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                                    {redFlags.map((f, i) => <li key={i} style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 6 }}><span style={{ color: "#ef4444" }}>−</span>{f}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Skill Breakdown */}
                          {skillsList.length > 0 && (
                            <div style={{ ...card, padding: 18 }}>
                              <h4 style={{ margin: "0 0 14px", fontSize: 11, fontWeight: 700, color: "#e2e8f0", textTransform: "uppercase", letterSpacing: "0.06em" }}>Skill Breakdown</h4>
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                {skillsList.map((sk, i) => (
                                  <div key={i}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{sk.name}</span>
                                    </div>
                                    <ScoreBarInline score={sk.score} />
                                    {(sk as { description?: string }).description && <p style={{ margin: "3px 0 0", fontSize: 11, color: "#64748b" }}>{(sk as { description?: string }).description}</p>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Areas for Improvement */}
                          {improvements.length > 0 && (
                            <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 12, padding: 16 }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" }} />Areas for Improvement
                              </h4>
                              <ol style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 5 }}>
                                {improvements.map((a, i) => <li key={i} style={{ fontSize: 12, color: "#94a3b8" }}>{a}</li>)}
                              </ol>
                            </div>
                          )}

                          {/* Open full report button */}
                          <button onClick={() => setModal(true)} style={{ padding: "10px 20px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", alignSelf: "flex-start" }}>
                            Open Full Report (with Radar)
                          </button>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Transcript Tab */}
                {activeTab === "transcript" && (
                  <div style={{ ...card, padding: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Interview Transcript</h3>
                    {selected.transcript && selected.transcript.length > 0 ? (
                      <TranscriptView transcript={selected.transcript} />
                    ) : (
                      <p style={{ color: "#64748b", textAlign: "center", padding: "24px 0", fontSize: 13 }}>No transcript available for this interview</p>
                    )}
                  </div>
                )}

                {/* Recording Tab */}
                {activeTab === "recording" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {!selected.recordingUrl && !selected.botAudioUrl && !selected.candidateAudioUrl ? (
                      <div style={{ ...card, padding: 40, textAlign: "center" }}>
                        <div style={{ fontSize: 36, marginBottom: 12 }}>🎵</div>
                        <p style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600, margin: "0 0 6px" }}>No recording available</p>
                        <p style={{ color: "#64748b", fontSize: 12 }}>Recordings are attached after the meeting ends</p>
                      </div>
                    ) : (
                      <>
                        {selected.recordingUrl && (
                          <div style={{ ...card, padding: 20 }}>
                            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Full Recording</p>
                            <audio controls src={selected.recordingUrl} style={{ width: "100%" }} />
                          </div>
                        )}
                        {selected.candidateAudioUrl && (
                          <div style={{ ...card, padding: 20 }}>
                            <p style={{ fontSize: 12, color: "#60a5fa", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Candidate Audio</p>
                            <audio controls src={selected.candidateAudioUrl} style={{ width: "100%" }} />
                          </div>
                        )}
                        {selected.botAudioUrl && (
                          <div style={{ ...card, padding: 20 }}>
                            <p style={{ fontSize: 12, color: "#a78bfa", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>AI Bot Audio</p>
                            <audio controls src={selected.botAudioUrl} style={{ width: "100%" }} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {modal && selected && (
        <ScorecardDetailModal
          meetings={[selected]}
          onClose={() => setModal(false)}
          dashboardUrl="/recruiter/history"
        />
      )}
    </div>
  );
}
