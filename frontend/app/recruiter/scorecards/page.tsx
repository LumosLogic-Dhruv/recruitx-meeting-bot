"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import ScorecardDetailModal, { ScorecardMeeting } from "@/components/ScorecardDetailModal";

const G = "rgba(255,255,255,";
const card: React.CSSProperties = {
  background: `${G}0.05)`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.09)`, borderRadius: 14,
};

interface Candidate {
  _id: string; name: string; email: string; roleName?: string;
  interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
}

function ScoreChip({ score }: { score: number }) {
  const [bg, col] = score >= 7 ? ["rgba(52,211,153,0.15)", "#34d399"] : score >= 5 ? ["rgba(251,191,36,0.15)", "#fbbf24"] : ["rgba(248,113,113,0.15)", "#f87171"];
  return <span style={{ background: bg, color: col, padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>{score}/10</span>;
}

function StatusBadge({ c }: { c: Candidate }) {
  const s = c.interviewStatus || "never_invited";
  const m: Record<string, [string, string, string]> = {
    never_invited:        [`${G}0.06)`, "#94a3b8", "Not Invited"],
    attempt_1_scheduled:  ["rgba(59,130,246,0.12)", "#93c5fd", "Interview 1 Sched."],
    attempt_2_scheduled:  ["rgba(59,130,246,0.12)", "#93c5fd", "Interview 2 Sched."],
    cooldown:             ["rgba(245,158,11,0.12)", "#fbbf24", c.cooldownUntil ? `Cooldown (${Math.max(0, Math.ceil((c.cooldownUntil - Date.now()) / 86400000))}d)` : "Cooldown"],
    locked:               ["rgba(239,68,68,0.12)", "#f87171", "Final/Locked"],
    completed:            ["rgba(16,185,129,0.12)", "#6ee7b7", "Completed"],
    partial:              ["rgba(234,179,8,0.12)", "#fde047", "Partial"],
    no_show:              ["rgba(245,158,11,0.12)", "#fbbf24", "No Show"],
  };
  const [bg, col, label] = m[s] || [`${G}0.06)`, "#94a3b8", s.replace(/_/g, " ")];
  return <span style={{ display: "inline-block", padding: "3px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color: col }}>{label}</span>;
}

export default function ScorecardsPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [meetings, setMeetings] = useState<ScorecardMeeting[]>([]);
  const [modal, setModal] = useState<{ name: string; meetings: ScorecardMeeting[] } | null>(null);

  useEffect(() => {
    Promise.all([
      api("/api/candidates").then(r => r.json()).then(d => setCandidates(d.candidates || [])),
      api("/api/meetings").then(r => r.json()).then(d => setMeetings(d.meetings || [])),
    ]);
  }, []);

  const scoredMeetings = meetings.filter(m => m.scorecard?.overall_score);
  const scores = scoredMeetings.map(m => m.scorecard!.overall_score!);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—";
  const hires = scoredMeetings.filter(m => ["STRONG HIRE", "HIRE"].includes(m.scorecard?.recommendation || "")).length;
  const done = candidates.filter(c => ["locked", "completed"].includes(c.interviewStatus || "")).length;

  const stats = [
    { label: "Total Candidates", val: candidates.length, col: "#a78bfa" },
    { label: "Interviews Done", val: done, col: "#60a5fa" },
    { label: "Average Score", val: avg, col: "#fbbf24" },
    { label: "Hire Decisions", val: hires, col: "#34d399" },
  ];

  function openModal(c: Candidate) {
    const cMeetings = meetings
      .filter(m => m.candidateName === c.name && m.scorecard?.overall_score)
      .sort((a, b) => (a.attemptNumber || 1) - (b.attemptNumber || 1));
    if (cMeetings.length) setModal({ name: c.name, meetings: cMeetings });
  }

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: "0 0 24px" }}>Candidate Scorecards</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...card, padding: 20, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 30, fontWeight: 800, color: s.col }}>{s.val}</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: 28 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Candidate", "Role", "Attempts", "Best Score", "Recommendation", "Status", "Scorecards"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "10px 13px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b", background: `${G}0.03)`, borderBottom: `2px solid ${G}0.09)` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "#64748b", padding: 40 }}>No candidates yet. <a href="/recruiter/add" style={{ color: "#a78bfa" }}>Add one →</a></td></tr>
            ) : candidates.map(c => {
              const cMeetings = meetings.filter(m => m.candidateName === c.name && m.scorecard?.overall_score)
                .sort((a, b) => (b.scorecard?.overall_score || 0) - (a.scorecard?.overall_score || 0));
              const best = cMeetings[0];
              return (
                <tr key={c._id}>
                  <td style={{ padding: 13, fontSize: 13, borderBottom: `1px solid ${G}0.05)` }}>
                    <strong style={{ color: "#f1f5f9" }}>{c.name}</strong><br />
                    <span style={{ fontSize: 11, color: "#64748b" }}>{c.email}</span>
                  </td>
                  <td style={{ padding: 13, fontSize: 13, borderBottom: `1px solid ${G}0.05)`, color: "#e2e8f0" }}>{c.roleName || best?.roleName || "—"}</td>
                  <td style={{ padding: 13, fontSize: 13, textAlign: "center", borderBottom: `1px solid ${G}0.05)`, color: "#94a3b8" }}>{c.attemptCount || 0}/2</td>
                  <td style={{ padding: 13, borderBottom: `1px solid ${G}0.05)` }}>
                    {best?.scorecard?.overall_score ? <ScoreChip score={best.scorecard.overall_score} /> : <span style={{ color: "#64748b" }}>—</span>}
                  </td>
                  <td style={{ padding: 13, fontSize: 12, color: "#94a3b8", borderBottom: `1px solid ${G}0.05)` }}>{best?.scorecard?.recommendation || "—"}</td>
                  <td style={{ padding: 13, borderBottom: `1px solid ${G}0.05)` }}><StatusBadge c={c} /></td>
                  <td style={{ padding: 13, borderBottom: `1px solid ${G}0.05)` }}>
                    {cMeetings.length > 0 ? (
                      <button onClick={() => openModal(c)} style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)", padding: "6px 13px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        View ({cMeetings.length})
                      </button>
                    ) : <span style={{ color: "#64748b", fontSize: 12 }}>No results yet</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && <ScorecardDetailModal meetings={modal.meetings} onClose={() => setModal(null)} dashboardUrl="/recruiter/scorecards" />}
    </>
  );
}
