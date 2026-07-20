"use client";
import { useState } from "react";

interface StrengthGap { name: string; score: number; }
interface Dimension { name: string; score: number; comment?: string; }
interface SkillItem { name: string; score: number; description?: string; }

export interface ScorecardData {
  overall_score?: number;
  recommendation?: string;
  summary?: string;
  top_strengths?: StrengthGap[];
  top_gaps?: StrengthGap[];
  dimensions?: Dimension[];
  green_flags?: string[];
  red_flags?: string[];
  skill_breakdown?: SkillItem[];
  areas_for_improvement?: string[];
  strengths?: string[];
  skill_scores?: Record<string, number>;
}

export interface ScorecardMeeting {
  _id: string;
  candidateName?: string;
  roleName?: string;
  scorecard?: ScorecardData;
  attemptNumber?: number;
  recordingUrl?: string;
  createdAt?: number;
  transcript?: { speaker: string; text: string }[];
}

interface Props {
  meetings: ScorecardMeeting[];
  onClose: () => void;
  dashboardUrl?: string;
}

function scoreColor(s: number) {
  return s >= 7 ? "#16a34a" : s >= 5 ? "#d97706" : "#dc2626";
}

function recColor(rec: string) {
  const r = rec.toUpperCase();
  if (r.includes("STRONG")) return "#16a34a";
  if (r === "HIRE") return "#2563eb";
  if (r === "MAYBE") return "#d97706";
  return "#dc2626";
}

function RadarChart({ dimensions }: { dimensions: Dimension[] }) {
  if (!dimensions || dimensions.length === 0) return null;
  const cx = 150, cy = 150, r = 90;
  const n = dimensions.length;

  function pt(i: number, val: number): [number, number] {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const d = (val / 10) * r;
    return [cx + d * Math.cos(angle), cy + d * Math.sin(angle)];
  }

  function gridPts(scale: number) {
    return Array.from({ length: n }, (_, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const d = (scale / 10) * r;
      return `${cx + d * Math.cos(angle)},${cy + d * Math.sin(angle)}`;
    }).join(" ");
  }

  const dataPts = dimensions.map((d, i) => pt(i, d.score));
  const dataStr = dataPts.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <svg viewBox="0 0 300 300" style={{ width: "100%", maxWidth: 300, display: "block", margin: "0 auto" }}>
      {[2, 4, 6, 8, 10].map(scale => (
        <polygon key={scale} points={gridPts(scale)} fill="none" stroke="#e2e8f0" strokeWidth={1} />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        return (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="#e2e8f0" strokeWidth={1} />
        );
      })}
      <polygon points={dataStr} fill="rgba(124,58,237,0.15)" stroke="#7c3aed" strokeWidth={2} />
      {dataPts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill="#7c3aed" />
      ))}
      {dimensions.map((d, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const lx = cx + (r + 26) * Math.cos(angle);
        const ly = cy + (r + 26) * Math.sin(angle);
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#64748b">
            {d.name} {d.score}
          </text>
        );
      })}
    </svg>
  );
}

export default function ScorecardDetailModal({ meetings, onClose, dashboardUrl }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [openDims, setOpenDims] = useState<Record<number, boolean>>({});
  const m = meetings[activeIdx];
  const sc = m?.scorecard || {};
  const score = sc.overall_score || 0;

  function toggleDim(i: number) {
    setOpenDims(prev => ({ ...prev, [i]: !prev[i] }));
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "28px 16px" }}
    >
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 800, overflow: "hidden", marginBottom: 28, position: "relative" }}>

        {/* Header */}
        <div style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "28px 32px 24px", position: "relative" }}>
          <button
            onClick={onClose}
            style={{ position: "absolute", top: 18, right: 22, background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1, padding: 4 }}
          >✕</button>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#94a3b8" }}>
                AI Screening Report
              </p>
              <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800, color: "#0f172a" }}>
                {m?.candidateName || "Candidate"}
              </h2>
              {m?.createdAt && (
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "#64748b" }}>
                  {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {m.roleName ? ` · ${m.roleName}` : ""}
                </p>
              )}
              {sc.recommendation && (
                <span style={{ display: "inline-block", background: recColor(sc.recommendation), color: "#fff", padding: "4px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700 }}>
                  {sc.recommendation}
                </span>
              )}
            </div>
            {score > 0 && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 52, fontWeight: 900, color: scoreColor(score), lineHeight: 1 }}>{score.toFixed(1)}</span>
                  <span style={{ fontSize: 20, color: "#94a3b8", fontWeight: 700, paddingBottom: 6 }}>/10</span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#94a3b8", textAlign: "right" }}>Overall Score</p>
              </div>
            )}
          </div>
          {sc.summary && (
            <p style={{ margin: "16px 0 0", color: "#475569", lineHeight: 1.7, fontSize: 14 }}>{sc.summary}</p>
          )}
        </div>

        {/* Attempt switcher */}
        {meetings.length > 1 && (
          <div style={{ padding: "12px 32px", background: "#fff", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 8 }}>
            {meetings.map((_, i) => (
              <button
                key={i}
                onClick={() => { setActiveIdx(i); setOpenDims({}); }}
                style={{ padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: activeIdx === i ? "#7c3aed" : "#f1f5f9", color: activeIdx === i ? "#fff" : "#374151" }}
              >
                Attempt {meetings[i].attemptNumber || i + 1}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding: "24px 32px 32px" }}>
          {!sc.overall_score ? (
            <p style={{ color: "#94a3b8", textAlign: "center", padding: 40 }}>No scorecard data for this attempt.</p>
          ) : (
            <>
              {/* Top Strengths + Top Gaps */}
              {((sc.top_strengths?.length ?? 0) > 0 || (sc.top_gaps?.length ?? 0) > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                  {(sc.top_strengths?.length ?? 0) > 0 && (
                    <div>
                      <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b" }}>Top Strengths</p>
                      {sc.top_strengths!.map((s, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
                          <span style={{ fontSize: 14, color: "#0f172a" }}>{s.name}</span>
                          <span style={{ background: scoreColor(s.score), color: "#fff", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{s.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(sc.top_gaps?.length ?? 0) > 0 && (
                    <div>
                      <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b" }}>Top Gaps</p>
                      {sc.top_gaps!.map((g, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
                          <span style={{ fontSize: 14, color: "#0f172a" }}>{g.name}</span>
                          <span style={{ background: scoreColor(g.score), color: "#fff", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{g.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Competency Radar */}
              {(sc.dimensions?.length ?? 0) > 0 && (
                <div style={{ background: "#f8fafc", borderRadius: 14, padding: "20px 24px", marginBottom: 24, border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Competency Radar</h4>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>Pass line at 6/10</span>
                  </div>
                  <RadarChart dimensions={sc.dimensions!} />
                </div>
              )}

              {/* Green + Red Flags */}
              {((sc.green_flags?.length ?? 0) > 0 || (sc.red_flags?.length ?? 0) > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                  {(sc.green_flags?.length ?? 0) > 0 && (
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 16 }}>
                      <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#16a34a" }}>● Green Flags</p>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {sc.green_flags!.map((f, i) => (
                          <li key={i} style={{ fontSize: 13, color: "#166534", marginBottom: 6, lineHeight: 1.5 }}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(sc.red_flags?.length ?? 0) > 0 && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 16 }}>
                      <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#dc2626" }}>● Red Flags</p>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {sc.red_flags!.map((f, i) => (
                          <li key={i} style={{ fontSize: 13, color: "#991b1b", marginBottom: 6, lineHeight: 1.5 }}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Skill Breakdown */}
              {(sc.skill_breakdown?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 14px" }}>Skill Breakdown</h4>
                  {sc.skill_breakdown!.map((sk, i) => (
                    <div key={i} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{sk.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(sk.score) }}>{sk.score}</span>
                      </div>
                      <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, marginBottom: 5, overflow: "hidden" }}>
                        <div style={{ height: 6, background: scoreColor(sk.score), borderRadius: 3, width: `${sk.score * 10}%` }} />
                      </div>
                      {sk.description && <p style={{ margin: 0, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{sk.description}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* Areas for Improvement */}
              {(sc.areas_for_improvement?.length ?? 0) > 0 && (
                <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: 18, marginBottom: 24 }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#d97706" }}>● Areas for Improvement</p>
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    {sc.areas_for_improvement!.map((a, i) => (
                      <li key={i} style={{ fontSize: 13, color: "#92400e", marginBottom: 6, lineHeight: 1.5 }}>{a}</li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Dimensions Accordion */}
              {(sc.dimensions?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 24 }}>
                  {sc.dimensions!.map((d, i) => (
                    <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
                      <button
                        onClick={() => toggleDim(i)}
                        style={{ width: "100%", background: "#f8fafc", border: "none", padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                      >
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{d.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ background: scoreColor(d.score), color: "#fff", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{d.score}</span>
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>{openDims[i] ? "▲" : "▼"}</span>
                        </div>
                      </button>
                      {openDims[i] && d.comment && (
                        <div style={{ padding: "12px 16px", background: "#fff", fontSize: 13, color: "#475569", lineHeight: 1.6, borderTop: "1px solid #f1f5f9" }}>
                          {d.comment}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Recording + Dashboard */}
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", paddingTop: 8 }}>
                {m?.recordingUrl ? (
                  <a href={m.recordingUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "#7c3aed", color: "#fff", padding: "11px 28px", borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
                    ▶ Watch Recording
                  </a>
                ) : (
                  <span style={{ color: "#94a3b8", fontSize: 13, padding: "11px 0" }}>Recording still processing — check back soon.</span>
                )}
                {dashboardUrl && (
                  <a href={dashboardUrl} style={{ display: "inline-block", background: "#f1f5f9", color: "#374151", padding: "11px 28px", borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: "none", border: "1px solid #e2e8f0" }}>
                    Go to Dashboard →
                  </a>
                )}
              </div>
            </>
          )}

          {/* Full Transcript */}
          {(m?.transcript?.length ?? 0) > 0 && (
            <div style={{ marginTop: 28, borderTop: "1px solid #f1f5f9", paddingTop: 20 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 14px" }}>
                Full Transcript <span style={{ fontWeight: 400, color: "#94a3b8" }}>({m!.transcript!.length} turns)</span>
              </h4>
              <div style={{ maxHeight: 440, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", background: "#f8fafc" }}>
                {m!.transcript!.map((turn, i) => {
                  const isBot = turn.speaker === "AI" || turn.speaker.toLowerCase().includes("recruit");
                  return (
                    <div key={i} style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: isBot ? "flex-end" : "flex-start" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isBot ? "#7c3aed" : "#2563eb", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        {isBot ? "AI Interviewer" : turn.speaker}
                      </span>
                      <div style={{
                        maxWidth: "80%", padding: "10px 14px",
                        borderRadius: isBot ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                        background: isBot ? "#ede9fe" : "#eff6ff",
                        color: isBot ? "#4c1d95" : "#1e3a8a",
                        fontSize: 13, lineHeight: 1.6,
                      }}>
                        {turn.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
