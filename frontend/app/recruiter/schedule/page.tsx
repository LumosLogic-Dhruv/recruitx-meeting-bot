"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";
const G = "rgba(255,255,255,";

const card: React.CSSProperties = {
  background: `${G}0.05)`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.09)`, borderRadius: 14, padding: 28,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "10px 13px", fontSize: 13, border: `1px solid ${G}0.12)`,
  borderRadius: 8, outline: "none", background: `${G}0.07)`, color: "#f1f5f9",
  fontFamily: "inherit", boxSizing: "border-box", colorScheme: "dark",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 4,
  textTransform: "uppercase", letterSpacing: "0.05em",
};

interface Candidate {
  _id: string; name: string; email: string; interviewStatus?: string;
  resumeFileName?: string; roleName?: string; generatedPrompt?: string;
  experienceYears?: string; currentCompany?: string;
}
interface Prompt { roleName: string; promptText: string; }
interface ScheduledInterview {
  _id: string; candidateName: string; roleName: string;
  scheduledAt: number; attemptNumber?: number; status: string;
}

const statusBg: Record<string, [string, string]> = {
  pending:   ["rgba(59,130,246,0.12)", "#93c5fd"],
  active:    ["rgba(16,185,129,0.12)", "#34d399"],
  completed: [`${G}0.05)`, "#64748b"],
  cancelled: ["rgba(239,68,68,0.10)", "#f87171"],
};

export default function SchedulePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledInterview[]>([]);
  const [form, setForm] = useState({ candidateId: "", datetime: "", duration: "30", role: "", promptText: "" });
  const [meetingMode, setMeetingMode] = useState<"auto" | "manual">("auto");
  const [manualUrl, setManualUrl] = useState("");
  const [alert, setAlert] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [promptSource, setPromptSource] = useState<"" | "saved" | "generated">("");

  useEffect(() => {
    const urlCandidateId = new URLSearchParams(window.location.search).get("candidateId") || "";
    Promise.all([loadCandidates(), loadPrompts(), loadScheduled()]).then(([allCandidates]) => {
      const pending = sessionStorage.getItem("pendingPrompt");
      if (pending) { setForm(p => ({ ...p, promptText: pending })); sessionStorage.removeItem("pendingPrompt"); }
      if (urlCandidateId && allCandidates) {
        const c = (allCandidates as Candidate[]).find(x => x._id === urlCandidateId);
        if (c) {
          setSelectedCandidate(c);
          setForm(p => ({ ...p, candidateId: urlCandidateId, role: c.roleName || "" }));
          if (!pending) {
            if (c.generatedPrompt) { setForm(p => ({ ...p, promptText: c.generatedPrompt! })); setPromptSource("saved"); }
            else { autoGenerateForSchedule(urlCandidateId); }
          }
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCandidates(): Promise<Candidate[]> {
    const res = await api("/api/candidates");
    const d = await res.json();
    const all: Candidate[] = d.candidates || [];
    setCandidates(all);
    return all;
  }
  async function loadPrompts() {
    const res = await api("/api/prompts");
    const d = await res.json();
    setPrompts(d.prompts || []);
  }
  async function loadScheduled() {
    try {
      const res = await api("/api/interviews/scheduled");
      const d = await res.json();
      setScheduled(d.interviews || []);
    } catch { /* ignore */ }
  }

  async function autoGenerateForSchedule(candidateId: string) {
    setGeneratingPrompt(true); setPromptSource("");
    try {
      const res = await fetch(`${BASE}/api/candidates/${candidateId}/generate-prompt`, {
        method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const d = await res.json();
      if (res.ok && d.prompt) {
        setForm(p => ({ ...p, promptText: d.prompt }));
        setPromptSource("generated");
        setCandidates(prev => prev.map(c => c._id === candidateId ? { ...c, generatedPrompt: d.prompt } : c));
      }
    } catch { /* ignore */ }
    finally { setGeneratingPrompt(false); }
  }

  function onCandidateChange(candidateId: string) {
    const c = candidates.find(c => c._id === candidateId) || null;
    setSelectedCandidate(c);
    setPromptSource("");
    setForm(p => ({ ...p, candidateId, role: p.role || c?.roleName || "", promptText: "" }));
    if (!c) return;
    if (c.generatedPrompt) { setForm(p => ({ ...p, promptText: c.generatedPrompt! })); setPromptSource("saved"); }
    else { autoGenerateForSchedule(candidateId); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (meetingMode === "manual" && !manualUrl.trim()) { setAlert({ msg: "Please enter the Google Meet link", type: "error" }); return; }
    setLoading(true);
    setAlert({ msg: meetingMode === "manual" ? "Scheduling with your meeting link..." : "Creating Google Meet and sending invite...", type: "info" });
    try {
      const res = await fetch(`${BASE}/api/interviews/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({
          candidate_id: form.candidateId,
          scheduled_at_iso: new Date(form.datetime).toISOString(),
          duration_minutes: parseInt(form.duration),
          role_name: form.role.trim() || "Interview",
          system_prompt: form.promptText.trim(),
          platform: meetingMode === "manual" ? "manual" : "google_meet",
          meeting_url: meetingMode === "manual" ? manualUrl.trim() : "",
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        const detail = d.detail || "Failed";
        if (detail === "GOOGLE_TOKEN_EXPIRED") {
          setAlert({ msg: "GOOGLE_TOKEN_EXPIRED", type: "error" });
        } else {
          throw new Error(detail);
        }
        return;
      }
      const emailNote = d.email_sent ? "Email invite sent ✓"
        : meetingMode === "manual" ? "Share meeting link with candidate manually"
        : "Configure SMTP in Settings to send emails";
      setAlert({ msg: `Interview scheduled! ${emailNote}`, type: d.email_sent ? "success" : "warning" });
      setForm({ candidateId: "", datetime: "", duration: "30", role: "", promptText: "" });
      setManualUrl(""); setMeetingMode("auto"); setSelectedCandidate(null); setPromptSource("");
      await Promise.all([loadCandidates(), loadScheduled()]);
    } catch (err: unknown) {
      setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" });
    } finally { setLoading(false); }
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this interview?")) return;
    await api(`/api/interviews/${id}/cancel`, { method: "POST" });
    loadScheduled();
  }

  const alertColors: Record<string, [string, string]> = {
    success: ["rgba(16,185,129,0.12)", "#34d399"],
    error:   ["rgba(239,68,68,0.12)", "#f87171"],
    warning: ["rgba(245,158,11,0.12)", "#fbbf24"],
    info:    ["rgba(59,130,246,0.12)", "#93c5fd"],
  };

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: "0 0 24px" }}>Schedule Interview</h1>
      <div style={{ display: "grid", gridTemplateColumns: "500px 1fr", gap: 24, alignItems: "start" }}>

        {/* ── Schedule Form ── */}
        <div style={card}>
          {/* Step indicators */}
          <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
            {[{ n: 1, label: "Select Candidate" }, { n: 2, label: "Interview Details" }, { n: 3, label: "Review & Send" }].map(({ n, label }) => {
              const done = n === 1 ? !!form.candidateId : n === 2 ? !!(form.datetime && form.role) : false;
              return (
                <div key={n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: done ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "rgba(255,255,255,0.07)", color: done ? "#fff" : "#a78bfa", border: done ? "none" : "1px solid rgba(139,92,246,0.3)" }}>{done ? "✓" : n}</div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textAlign: "center" }}>{label}</span>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleSubmit}>
            {/* Step 1 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...lbl, marginBottom: 6 }}>
                <span style={{ background: "rgba(139,92,246,0.2)", color: "#c4b5fd", padding: "1px 7px", borderRadius: 12, fontSize: 10, marginRight: 7, fontWeight: 700 }}>1</span>
                Select Candidate
              </label>
              <select required style={inp} value={form.candidateId} onChange={e => onCandidateChange(e.target.value)}>
                <option value="">Choose a candidate...</option>
                {candidates.map(c => {
                  const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "").replace(/_/g, " ");
                  return <option key={c._id} value={c._id}>{c.name} — {c.roleName || c.email} [{s}]</option>;
                })}
              </select>
            </div>

            {selectedCandidate && (
              <div style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#c4b5fd" }}>{selectedCandidate.name}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 3 }}>
                      {selectedCandidate.roleName || "Role not set"}
                      {selectedCandidate.currentCompany ? ` · ${selectedCandidate.currentCompany}` : ""}
                      {selectedCandidate.experienceYears ? ` · ${selectedCandidate.experienceYears} yrs` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      {selectedCandidate.resumeFileName && <span style={{ fontSize: 10, background: "rgba(16,185,129,0.15)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.2)", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>Resume ready</span>}
                      {selectedCandidate.generatedPrompt && <span style={{ fontSize: 10, background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.2)", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>AI prompt ready</span>}
                    </div>
                  </div>
                  <Link href={`/recruiter/candidates/${selectedCandidate._id}`} style={{ fontSize: 11, color: "#a78bfa", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap", marginLeft: 8 }}>View Profile →</Link>
                </div>
              </div>
            )}

            {/* Step 2 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...lbl, marginBottom: 12 }}>
                <span style={{ background: "rgba(139,92,246,0.2)", color: "#c4b5fd", padding: "1px 7px", borderRadius: 12, fontSize: 10, marginRight: 7, fontWeight: 700 }}>2</span>
                Interview Details
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><label style={lbl}>Date &amp; Time *</label><input type="datetime-local" required style={inp} value={form.datetime} onChange={e => setForm(p => ({ ...p, datetime: e.target.value }))} /></div>
                <div><label style={lbl}>Duration</label>
                  <select style={inp} value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}>
                    <option value="20">20 min</option><option value="30">30 min</option>
                    <option value="45">45 min</option><option value="60">60 min</option>
                  </select>
                </div>
              </div>
              <div><label style={lbl}>Role / Position *</label><input required style={inp} placeholder="Full Stack Developer" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} /></div>
            </div>

            {/* Meeting link */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ ...lbl, marginBottom: 10 }}>Google Meet Link</label>
              <div style={{ display: "flex", gap: 0, marginBottom: 14, border: `1px solid ${G}0.12)`, borderRadius: 8, overflow: "hidden" }}>
                {(["auto", "manual"] as const).map(mode => (
                  <button key={mode} type="button" onClick={() => setMeetingMode(mode)} style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: meetingMode === mode ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.04)", color: meetingMode === mode ? "#c4b5fd" : "#94a3b8", transition: "all .15s" }}>
                    {mode === "auto" ? "Auto (Google Calendar)" : "Paste my own link"}
                  </button>
                ))}
              </div>
              {meetingMode === "manual" ? (
                <div>
                  <input type="url" placeholder="https://meet.google.com/abc-def-ghi" value={manualUrl} onChange={e => setManualUrl(e.target.value)} style={inp} />
                  <div style={{ marginTop: 12, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#fbbf24", marginBottom: 6 }}>⚡ Disable waiting room before interview</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
                      Open the Meet link → join → click the <strong style={{ color: "#e2e8f0" }}>shield/lock icon</strong> → turn <strong style={{ color: "#e2e8f0" }}>&quot;Quick access&quot; ON</strong>.<br />
                      This allows the AI bot to join automatically.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b", background: `${G}0.03)`, border: `1px solid ${G}0.08)`, borderRadius: 8, padding: "10px 14px" }}>
                  A Google Meet link will be generated via your connected Google Calendar account.
                </div>
              )}
            </div>

            {/* Step 3: Prompt */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={{ ...lbl, marginBottom: 0 }}>
                  <span style={{ background: "rgba(139,92,246,0.2)", color: "#c4b5fd", padding: "1px 7px", borderRadius: 12, fontSize: 10, marginRight: 7, fontWeight: 700 }}>3</span>
                  AI Interview Prompt
                </label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {promptSource === "saved" && <span style={{ fontSize: 10, background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.2)", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>From saved profile</span>}
                  {promptSource === "generated" && <span style={{ fontSize: 10, background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>Auto-generated</span>}
                  {form.candidateId && !generatingPrompt && <button type="button" onClick={() => autoGenerateForSchedule(form.candidateId)} style={{ fontSize: 10, color: "#a78bfa", background: "none", border: "1px solid rgba(139,92,246,0.25)", padding: "2px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Regenerate</button>}
                </div>
              </div>
              {generatingPrompt ? (
                <div style={{ padding: "14px", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, fontSize: 13, color: "#a78bfa", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⏳</span>
                  <div><div style={{ fontWeight: 700 }}>Generating AI interview prompt...</div><div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Analyzing candidate profile and resume</div></div>
                </div>
              ) : (
                <>
                  {!form.candidateId && <div style={{ padding: "12px 14px", background: `${G}0.03)`, border: `1px dashed ${G}0.10)`, borderRadius: 8, fontSize: 12, color: "#64748b", marginBottom: 8 }}>Select a candidate — the AI prompt will be auto-generated from their profile.</div>}
                  <select style={{ ...inp, marginBottom: 8, fontSize: 12 }} value="" onChange={e => { if (e.target.value) { setForm(p => ({ ...p, promptText: e.target.value })); setPromptSource(""); } }}>
                    <option value="">— Override with a saved prompt —</option>
                    {prompts.map((p, i) => <option key={i} value={p.promptText}>{p.roleName}</option>)}
                  </select>
                  <textarea rows={7} style={{ ...inp, resize: "vertical", fontSize: 12, lineHeight: 1.6 }} placeholder="AI interview prompt will appear here..." value={form.promptText} onChange={e => { setForm(p => ({ ...p, promptText: e.target.value })); setPromptSource(""); }} />
                </>
              )}
              <p style={{ fontSize: 11, color: "#64748b", margin: "4px 0 0" }}>Candidate profile and resume context is automatically prepended.</p>
            </div>

            {alert && alert.msg === "GOOGLE_TOKEN_EXPIRED" ? (
              <div style={{ padding: "14px 16px", borderRadius: 10, fontSize: 13, marginBottom: 14, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Google account token expired</div>
                <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 10, lineHeight: 1.6 }}>
                  Your Google Calendar connection has expired or been revoked.<br />
                  Reconnect it in Settings to auto-generate Google Meet links.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Link href="/recruiter/schedule" style={{ flex: 1 }}>
                    <button type="button" onClick={() => { setMeetingMode("manual"); setAlert(null); }} style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.07)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, cursor: "pointer" }}>
                      Use manual link instead
                    </button>
                  </Link>
                  <Link href="/admin" style={{ flex: 1 }}>
                    <button type="button" style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 700, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer" }}>
                      Go to Settings →
                    </button>
                  </Link>
                </div>
              </div>
            ) : alert ? (
              <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 13, marginBottom: 14, ...(alertColors[alert.type] ? { background: alertColors[alert.type][0], color: alertColors[alert.type][1] } : {}) }}>
                {alert.msg}
              </div>
            ) : null}
            <button type="submit" disabled={loading || generatingPrompt} style={{ width: "100%", padding: "12px 22px", background: (loading || generatingPrompt) ? "rgba(139,92,246,0.3)" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: (loading || generatingPrompt) ? "not-allowed" : "pointer" }}>
              {loading ? "Scheduling..." : generatingPrompt ? "Wait — generating prompt..." : "Schedule & Send Invite →"}
            </button>
          </form>
        </div>

        {/* ── Scheduled list ── */}
        <div style={card}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px" }}>Scheduled Interviews</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Candidate", "Role", "Date & Time", "Attempt", "Status", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b", background: `${G}0.03)`, borderBottom: `2px solid ${G}0.09)` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scheduled.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 40, fontSize: 13 }}>No interviews scheduled yet.</td></tr>
              ) : scheduled.map(iv => {
                const [sbg, scol] = statusBg[iv.status] || [`${G}0.05)`, "#64748b"];
                return (
                  <tr key={iv._id}>
                    <td style={{ padding: "12px", fontSize: 13, borderBottom: `1px solid ${G}0.05)`, color: "#f1f5f9", fontWeight: 600 }}>{iv.candidateName}</td>
                    <td style={{ padding: "12px", fontSize: 12, borderBottom: `1px solid ${G}0.05)`, color: "#94a3b8" }}>{iv.roleName}</td>
                    <td style={{ padding: "12px", fontSize: 11, color: "#64748b", borderBottom: `1px solid ${G}0.05)` }}>{new Date(iv.scheduledAt).toISOString().replace("T", " ").slice(0, 16)} UTC</td>
                    <td style={{ padding: "12px", textAlign: "center", borderBottom: `1px solid ${G}0.05)`, color: "#94a3b8", fontSize: 12 }}>#{iv.attemptNumber || 1}</td>
                    <td style={{ padding: "12px", borderBottom: `1px solid ${G}0.05)` }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: sbg, color: scol }}>{iv.status}</span>
                    </td>
                    <td style={{ padding: "12px", borderBottom: `1px solid ${G}0.05)` }}>
                      {iv.status === "pending" ? (
                        <button onClick={() => cancel(iv._id)} style={{ background: "rgba(239,68,68,0.10)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)", padding: "4px 10px", fontSize: 11, borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Cancel</button>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
