"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import ScorecardDetailModal, { ScorecardMeeting } from "@/components/ScorecardDetailModal";

interface Candidate {
  _id: string; name: string; email: string; roleName?: string;
  interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
}

function ScoreChip({ score }: { score: number }) {
  const color = score >= 7 ? "#16a34a" : score >= 5 ? "#d97706" : "#dc2626";
  return <span style={{ background: color, color: "#fff", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700 }}>{score}/10</span>;
}

function StatusBadge({ c }: { c: Candidate }) {
  const s = c.interviewStatus || "never_invited";
  const map: Record<string, [string, string, string]> = {
    never_invited: ["#f1f5f9", "#64748b", "Not Invited"],
    attempt_1_scheduled: ["#eff6ff", "#1d4ed8", "Interview 1 Sched."],
    cooldown: ["#fff7ed", "#c2410c", coolDays(c)],
    attempt_2_scheduled: ["#eff6ff", "#1d4ed8", "Interview 2 Sched."],
    locked: ["#fef2f2", "#dc2626", "Final/Locked"],
    completed: ["#f0fdf4", "#16a34a", "Completed"],
    partial: ["#fefce8", "#854d0e", "Partial"],
    no_show: ["#fff7ed", "#c2410c", "No Show"],
  };
  const [bg, col, label] = map[s] || ["#f1f5f9", "#64748b", s];
  return <span style={{ display: "inline-block", padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: bg, color: col }}>{label}</span>;
}
function coolDays(c: Candidate) {
  if (!c.cooldownUntil) return "Cooldown";
  return `Cooldown (${Math.max(0, Math.ceil((c.cooldownUntil - Date.now()) / 86400000))}d)`;
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
    { label: "Total Candidates", val: candidates.length, color: "#7c3aed" },
    { label: "Interviews Done", val: done, color: "#2563eb" },
    { label: "Average Score", val: avg, color: "#d97706" },
    { label: "Hire Decisions", val: hires, color: "#16a34a" },
  ];

  function openModal(c: Candidate) {
    const cMeetings = meetings
      .filter(m => m.candidateName === c.name && m.scorecard?.overall_score)
      .sort((a, b) => (a.attemptNumber || 1) - (b.attemptNumber || 1));
    if (cMeetings.length) setModal({ name: c.name, meetings: cMeetings });
  }

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 24px" }}>Candidate Scorecards</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 30, fontWeight: 800, color: s.color }}>{s.val}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em" }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Candidate", "Role", "Attempts", "Best Score", "Recommendation", "Status", "Scorecards"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "10px 13px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "#64748b", padding: 40 }}>No candidates yet. <a href="/recruiter/add" style={{ color: "#7c3aed" }}>Add one →</a></td></tr>
            ) : candidates.map(c => {
              const cMeetings = meetings.filter(m => m.candidateName === c.name && m.scorecard?.overall_score)
                .sort((a, b) => (b.scorecard?.overall_score || 0) - (a.scorecard?.overall_score || 0));
              const best = cMeetings[0];
              return (
                <tr key={c._id}>
                  <td style={{ padding: 13, fontSize: 14, borderBottom: "1px solid #f1f5f9" }}>
                    <strong>{c.name}</strong><br />
                    <span style={{ fontSize: 12, color: "#64748b" }}>{c.email}</span>
                  </td>
                  <td style={{ padding: 13, fontSize: 14, borderBottom: "1px solid #f1f5f9" }}>{c.roleName || best?.roleName || "—"}</td>
                  <td style={{ padding: 13, fontSize: 14, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>{c.attemptCount || 0}/2</td>
                  <td style={{ padding: 13, borderBottom: "1px solid #f1f5f9" }}>
                    {best?.scorecard?.overall_score ? <ScoreChip score={best.scorecard.overall_score} /> : <span style={{ color: "#64748b" }}>—</span>}
                  </td>
                  <td style={{ padding: 13, fontSize: 13, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{best?.scorecard?.recommendation || "—"}</td>
                  <td style={{ padding: 13, borderBottom: "1px solid #f1f5f9" }}><StatusBadge c={c} /></td>
                  <td style={{ padding: 13, borderBottom: "1px solid #f1f5f9" }}>
                    {cMeetings.length > 0 ? (
                      <button onClick={() => openModal(c)} style={{ background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe", padding: "6px 13px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        View ({cMeetings.length})
                      </button>
                    ) : <span style={{ color: "#64748b", fontSize: 13 }}>No results yet</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <ScorecardDetailModal
          meetings={modal.meetings}
          onClose={() => setModal(null)}
          dashboardUrl="/recruiter/scorecards"
        />
      )}
    </>
  );
}
