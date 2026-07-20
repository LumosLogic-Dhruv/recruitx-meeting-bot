"use client";
import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
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

// ── Color helpers ──────────────────────────────────────────────────────────
function scoreColor(s: number): string {
  if (s >= 8) return "#22c55e";
  if (s >= 6) return "#8b5cf6";
  if (s >= 4) return "#f59e0b";
  return "#ef4444";
}

function recInfo(rec: string): { label: string; color: string } {
  const r = rec.toUpperCase();
  if (r.includes("STRONG HIRE")) return { label: "Strong Hire", color: "#22c55e" };
  if (r === "HIRE")              return { label: "Hire",        color: "#8b5cf6" };
  if (r === "MAYBE")             return { label: "Maybe",       color: "#f59e0b" };
  return                                { label: "No Hire",     color: "#ef4444" };
}

const G = "rgba(255,255,255,";

// ── Score Gauge (conic-gradient ring) ─────────────────────────────────────
function ScoreGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score / 10));
  const col = scoreColor(score);
  return (
    <div style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: `conic-gradient(${col} ${pct * 360}deg, rgba(255,255,255,0.08) 0deg)`,
      }} />
      <div style={{
        position: "absolute", inset: 6, borderRadius: "50%",
        background: "rgba(8,8,17,0.95)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: col, lineHeight: 1 }}>{score.toFixed(1)}</span>
        <span style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>/ 10</span>
      </div>
    </div>
  );
}

// ── Score Bar ──────────────────────────────────────────────────────────────
function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const threshPct = (6 / max) * 100;
  const col = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 99, background: `${G}0.07)`, position: "relative", overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 99, background: col, width: `${pct}%`, transition: "width .4s ease" }} />
        {/* Pass threshold tick */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${threshPct}%`, width: 1, background: "rgba(255,255,255,0.3)" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 800, color: col, minWidth: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{score}</span>
    </div>
  );
}

// ── Radar Chart (pure SVG, dark) ───────────────────────────────────────────
function RadarChart({ dimensions }: { dimensions: Dimension[] }) {
  if (!dimensions || dimensions.length < 3) return null;
  const size = 280, cx = 140, cy = 140, r = 90;
  const n = dimensions.length;
  const angleStep = (2 * Math.PI) / n;

  function pt(i: number, val: number): [number, number] {
    const angle = angleStep * i - Math.PI / 2;
    const d = (val / 10) * r;
    return [cx + d * Math.cos(angle), cy + d * Math.sin(angle)];
  }
  function gridPts(scale: number) {
    return Array.from({ length: n }, (_, i) => {
      const angle = angleStep * i - Math.PI / 2;
      const d = (scale / 10) * r;
      return `${cx + d * Math.cos(angle)},${cy + d * Math.sin(angle)}`;
    }).join(" ");
  }

  const dataPts = dimensions.map((d, i) => pt(i, d.score));
  const dataStr = dataPts.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: 280, display: "block", margin: "0 auto" }}>
      {[2, 4, 6, 8, 10].map(scale => (
        <polygon key={scale} points={gridPts(scale)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const angle = angleStep * i - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="rgba(255,255,255,0.1)" strokeWidth={0.8} />;
      })}
      <polygon points={dataStr} fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" strokeWidth={2} />
      {dataPts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.5} fill="#8b5cf6" />)}
      {dimensions.map((d, i) => {
        const angle = angleStep * i - Math.PI / 2;
        const lx = cx + (r + 28) * Math.cos(angle);
        const ly = cy + (r + 28) * Math.sin(angle);
        const col = scoreColor(d.score);
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#94a3b8">
            {d.name} <tspan fill={col} fontWeight="bold">{d.score}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────
export default function ScorecardDetailModal({ meetings, onClose, dashboardUrl }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [openDims, setOpenDims] = useState<Record<number, boolean>>({});
  const [showTranscript, setShowTranscript] = useState(false);

  const m = meetings[activeIdx];
  const sc = m?.scorecard || {};
  const score = sc.overall_score || 0;
  const rec = sc.recommendation ? recInfo(sc.recommendation) : null;

  // Build skills list from whatever field is available
  const skillsList: { name: string; score: number; notes?: string }[] = sc.skill_breakdown?.length
    ? sc.skill_breakdown.map(s => ({ name: s.name, score: s.score, notes: s.description }))
    : sc.skill_scores
    ? Object.entries(sc.skill_scores).map(([name, s]) => ({ name, score: s }))
    : [];

  // Snapshot: top 2 strengths + bottom 2 gaps
  const sortedSkills = [...skillsList].sort((a, b) => b.score - a.score);
  const topStrengths = sc.top_strengths?.length ? sc.top_strengths : sortedSkills.slice(0, 2).map(s => ({ name: s.name, score: s.score }));
  const topGaps = sc.top_gaps?.length ? sc.top_gaps : sortedSkills.slice(-2).reverse().map(s => ({ name: s.name, score: s.score }));

  // Green flags: merge green_flags + strengths arrays
  const greenFlags = [...(sc.green_flags || []), ...(sc.strengths || [])];
  const redFlags = sc.red_flags || [];
  const improvements = sc.areas_for_improvement || [];

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "28px 16px" }}
    >
      <div style={{
        background: "rgba(10,10,20,0.96)", backdropFilter: "blur(30px)",
        border: `1px solid ${G}0.10)`,
        borderRadius: 20, width: "100%", maxWidth: 820,
        overflow: "hidden", marginBottom: 28, position: "relative",
      }}>

        {/* ── Header ── */}
        <div style={{ background: `${G}0.04)`, borderBottom: `1px solid ${G}0.09)`, padding: "28px 32px 24px", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 18, right: 22, background: `${G}0.06)`, border: `1px solid ${G}0.10)`, borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 16 }}>✕</button>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
            {score > 0 && <ScoreGauge score={score} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b" }}>AI Interview Report</p>
              <h2 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: "#f1f5f9" }}>{m?.candidateName || "Candidate"}</h2>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "#64748b" }}>
                {m?.roleName || "Interview"}
                {m?.createdAt ? ` · ${new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                {m?.attemptNumber ? ` · Attempt #${m.attemptNumber}` : ""}
              </p>
              {rec && (
                <span style={{ display: "inline-block", background: `${rec.color}18`, color: rec.color, border: `1px solid ${rec.color}30`, padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                  {rec.label}
                </span>
              )}
            </div>
          </div>

          {sc.summary && (
            <p style={{ margin: "16px 0 0", color: "#94a3b8", lineHeight: 1.7, fontSize: 13, borderLeft: `3px solid ${rec?.color || "#8b5cf6"}`, paddingLeft: 12, fontStyle: "italic" }}>
              {sc.summary}
            </p>
          )}
        </div>

        {/* ── Attempt switcher ── */}
        {meetings.length > 1 && (
          <div style={{ padding: "12px 32px", background: `${G}0.03)`, borderBottom: `1px solid ${G}0.07)`, display: "flex", gap: 8 }}>
            {meetings.map((_, i) => (
              <button key={i} onClick={() => { setActiveIdx(i); setOpenDims({}); setShowTranscript(false); }} style={{ padding: "6px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: activeIdx === i ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : `${G}0.07)`, color: activeIdx === i ? "#fff" : "#94a3b8" }}>
                Attempt {meetings[i].attemptNumber || i + 1}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding: "24px 32px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
          {!sc.overall_score ? (
            <p style={{ color: "#64748b", textAlign: "center", padding: 40 }}>No scorecard data for this attempt.</p>
          ) : (
            <>
              {/* ── Snapshot: Top Strengths + Top Gaps ── */}
              {(topStrengths.length > 0 || topGaps.length > 0) && (
                <div style={{ background: `${G}0.04)`, border: `1px solid ${G}0.09)`, borderRadius: 14, padding: 20 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    {topStrengths.length > 0 && (
                      <div>
                        <p style={{ margin: "0 0 10px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#64748b" }}>Top Strengths</p>
                        {topStrengths.map((s, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${G}0.06)` }}>
                            <span style={{ fontSize: 13, color: "#e2e8f0" }}>{s.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: scoreColor(s.score), fontVariantNumeric: "tabular-nums" }}>{s.score}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {topGaps.length > 0 && (
                      <div>
                        <p style={{ margin: "0 0 10px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#64748b" }}>Top Gaps</p>
                        {topGaps.map((g, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${G}0.06)` }}>
                            <span style={{ fontSize: 13, color: "#e2e8f0" }}>{g.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: scoreColor(g.score), fontVariantNumeric: "tabular-nums" }}>{g.score}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Competency Radar ── */}
              {(sc.dimensions?.length ?? 0) >= 3 && (
                <div style={{ background: `${G}0.04)`, border: `1px solid ${G}0.09)`, borderRadius: 14, padding: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e2e8f0", textTransform: "uppercase", letterSpacing: "0.06em" }}>Competency Radar</h3>
                    <span style={{ fontSize: 10, color: "#64748b" }}>Pass line at 6/10</span>
                  </div>
                  <RadarChart dimensions={sc.dimensions!} />
                </div>
              )}

              {/* ── Green Flags / Red Flags ── */}
              {(greenFlags.length > 0 || redFlags.length > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {greenFlags.length > 0 && (
                    <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 14, padding: 18 }}>
                      <h3 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#22c55e", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                        Green Flags
                      </h3>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                        {greenFlags.map((f, i) => (
                          <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#94a3b8" }}>
                            <span style={{ color: "#22c55e", flexShrink: 0 }}>+</span>{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {redFlags.length > 0 && (
                    <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 14, padding: 18 }}>
                      <h3 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#ef4444", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
                        Red Flags
                      </h3>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                        {redFlags.map((f, i) => (
                          <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#94a3b8" }}>
                            <span style={{ color: "#ef4444", flexShrink: 0 }}>−</span>{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* ── Skill Breakdown ── */}
              {skillsList.length > 0 && (
                <div style={{ background: `${G}0.04)`, border: `1px solid ${G}0.09)`, borderRadius: 14, padding: 20 }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 12, fontWeight: 700, color: "#e2e8f0", textTransform: "uppercase", letterSpacing: "0.06em" }}>Skill Breakdown</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {skillsList.map((sk, i) => (
                      <div key={i}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{sk.name}</span>
                        </div>
                        <ScoreBar score={sk.score} />
                        {sk.notes && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{sk.notes}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Areas for Improvement ── */}
              {improvements.length > 0 && (
                <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 14, padding: 18 }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
                    Areas for Improvement
                  </h3>
                  <ol style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {improvements.map((a, i) => (
                      <li key={i} style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{a}</li>
                    ))}
                  </ol>
                </div>
              )}

              {/* ── Dimensions Accordion ── */}
              {(sc.dimensions?.length ?? 0) > 0 && (
                <div>
                  <h3 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#e2e8f0", textTransform: "uppercase", letterSpacing: "0.06em" }}>Dimensional Breakdown</h3>
                  <div style={{ borderRadius: 14, border: `1px solid ${G}0.09)`, overflow: "hidden" }}>
                    {sc.dimensions!.map((d, i) => {
                      const col = scoreColor(d.score);
                      const isLast = i === sc.dimensions!.length - 1;
                      return (
                        <div key={i} style={{ borderBottom: isLast ? "none" : `1px solid ${G}0.07)` }}>
                          <button
                            onClick={() => setOpenDims(prev => ({ ...prev, [i]: !prev[i] }))}
                            style={{ width: "100%", background: openDims[i] ? `${G}0.06)` : `${G}0.04)`, border: "none", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", transition: "background .15s" }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{d.name}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ background: `${col}20`, color: col, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 800 }}>{d.score}</span>
                              <span style={{ color: "#64748b", fontSize: 11 }}>{openDims[i] ? "▲" : "▼"}</span>
                            </div>
                          </button>
                          {openDims[i] && d.comment && (
                            <div style={{ padding: "12px 18px 16px", background: `${G}0.03)`, fontSize: 13, color: "#94a3b8", lineHeight: 1.7, borderTop: `1px solid ${G}0.06)` }}>
                              {d.comment}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Actions ── */}
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", paddingTop: 4 }}>
                {m?.recordingUrl ? (
                  <a href={m.recordingUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", padding: "10px 24px", borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                    ▶ Watch Recording
                  </a>
                ) : (
                  <span style={{ color: "#64748b", fontSize: 13, padding: "10px 0" }}>Recording still processing — check back soon.</span>
                )}
                {(m?.transcript?.length ?? 0) > 0 && (
                  <button onClick={() => setShowTranscript(v => !v)} style={{ background: `${G}0.07)`, border: `1px solid ${G}0.12)`, color: "#e2e8f0", padding: "10px 24px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    {showTranscript ? "Hide Transcript" : `Show Transcript (${m!.transcript!.length} turns)`}
                  </button>
                )}
                {dashboardUrl && (
                  <a href={dashboardUrl} style={{ display: "inline-block", background: `${G}0.06)`, border: `1px solid ${G}0.10)`, color: "#94a3b8", padding: "10px 24px", borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                    Dashboard →
                  </a>
                )}
              </div>
            </>
          )}

          {/* ── Transcript ── */}
          {showTranscript && (m?.transcript?.length ?? 0) > 0 && (
            <div style={{ borderTop: `1px solid ${G}0.09)`, paddingTop: 20 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Full Transcript <span style={{ fontWeight: 400, color: "#64748b" }}>({m!.transcript!.length} turns)</span>
              </h4>
              <div style={{ maxHeight: 440, overflowY: "auto", border: `1px solid ${G}0.09)`, borderRadius: 12, padding: "16px 20px", background: `${G}0.03)`, display: "flex", flexDirection: "column", gap: 14 }}>
                {m!.transcript!.map((turn, i) => {
                  const isBot = turn.speaker === "AI" || turn.speaker.toLowerCase().includes("recruit");
                  return (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isBot ? "flex-end" : "flex-start" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: isBot ? "#a78bfa" : "#60a5fa", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".06em" }}>
                        {isBot ? "AI Interviewer" : turn.speaker}
                      </span>
                      <div style={{
                        maxWidth: "80%", padding: "10px 14px", fontSize: 13, lineHeight: 1.6,
                        borderRadius: isBot ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                        background: isBot ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.12)",
                        color: isBot ? "#c4b5fd" : "#93c5fd",
                        border: `1px solid ${isBot ? "rgba(139,92,246,0.2)" : "rgba(59,130,246,0.15)"}`,
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
