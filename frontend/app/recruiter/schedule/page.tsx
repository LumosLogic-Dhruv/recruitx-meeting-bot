"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface Candidate {
  _id: string;
  name: string;
  email: string;
  interviewStatus?: string;
  resumeFileName?: string;
  roleName?: string;
  generatedPrompt?: string;
  experienceYears?: string;
  currentCompany?: string;
}
interface Prompt { roleName: string; promptText: string; }
interface ScheduledInterview {
  _id: string;
  candidateName: string;
  roleName: string;
  scheduledAt: number;
  attemptNumber?: number;
  status: string;
}

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
      if (pending) {
        setForm(p => ({ ...p, promptText: pending }));
        sessionStorage.removeItem("pendingPrompt");
      }
      if (urlCandidateId && allCandidates) {
        const c = (allCandidates as Candidate[]).find(x => x._id === urlCandidateId);
        if (c) {
          setSelectedCandidate(c);
          setForm(p => ({ ...p, candidateId: urlCandidateId, role: c.roleName || "" }));
          if (!pending) {
            if (c.generatedPrompt) {
              setForm(p => ({ ...p, promptText: c.generatedPrompt! }));
              setPromptSource("saved");
            } else {
              autoGenerateForSchedule(urlCandidateId);
            }
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
    setGeneratingPrompt(true);
    setPromptSource("");
    try {
      const res = await fetch(`${BASE}/api/candidates/${candidateId}/generate-prompt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
    setForm(p => ({
      ...p,
      candidateId,
      role: p.role || c?.roleName || "",
      promptText: "",
    }));
    if (!c) return;
    if (c.generatedPrompt) {
      setForm(p => ({ ...p, promptText: c.generatedPrompt! }));
      setPromptSource("saved");
    } else {
      autoGenerateForSchedule(candidateId);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (meetingMode === "manual" && !manualUrl.trim()) {
      setAlert({ msg: "Please enter the Google Meet link", type: "error" }); return;
    }
    setLoading(true);
    setAlert({ msg: meetingMode === "manual" ? "Scheduling interview with your meeting link..." : "Creating Google Meet and sending invite...", type: "info" });
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
      if (!res.ok) throw new Error(d.detail || "Failed");
      setAlert({ msg: `Interview scheduled! Email invite ${d.email_sent ? "sent ✓" : "failed — check SMTP settings"}`, type: "success" });
      setForm({ candidateId: "", datetime: "", duration: "30", role: "", promptText: "" });
      setManualUrl("");
      setMeetingMode("auto");
      setSelectedCandidate(null);
      setPromptSource("");
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

  const inp: React.CSSProperties = {
    width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0",
    borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 };
  const statusBg: Record<string, string> = { pending: "#eff6ff|#1d4ed8", active: "#f0fdf4|#16a34a", completed: "#f1f5f9|#64748b", cancelled: "#fef2f2|#dc2626" };

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 24px" }}>Schedule Interview</h1>
      <div style={{ display: "grid", gridTemplateColumns: "500px 1fr", gap: 24, alignItems: "start" }}>

        {/* ── Schedule Form ── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>

          {/* Step indicators */}
          <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
            {[
              { n: 1, label: "Select Candidate" },
              { n: 2, label: "Interview Details" },
              { n: 3, label: "Review & Send" },
            ].map(({ n, label }) => {
              const done = n === 1 ? !!form.candidateId : n === 2 ? !!(form.datetime && form.role) : false;
              return (
                <div key={n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: done ? "#7c3aed" : form.candidateId && n === 2 ? "#ede9fe" : "#f1f5f9", color: done ? "#fff" : "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                    {done ? "✓" : n}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textAlign: "center" }}>{label}</span>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleSubmit}>
            {/* STEP 1: Candidate */}
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>
                <span style={{ background: "#7c3aed", color: "#fff", padding: "1px 7px", borderRadius: 12, fontSize: 11, marginRight: 7 }}>1</span>
                Select Candidate
              </label>
              <select
                required
                style={inp}
                value={form.candidateId}
                onChange={e => onCandidateChange(e.target.value)}
              >
                <option value="">Choose a candidate...</option>
                {candidates.map(c => {
                  const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "").replace(/_/g, " ");
                  return <option key={c._id} value={c._id}>{c.name} — {c.roleName || c.email} [{s}]</option>;
                })}
              </select>
            </div>

            {/* Candidate snapshot card */}
            {selectedCandidate && (
              <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: "12px 14px", marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#4c1d95" }}>{selectedCandidate.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>
                      {selectedCandidate.roleName || "Role not set"}
                      {selectedCandidate.currentCompany ? ` · ${selectedCandidate.currentCompany}` : ""}
                      {selectedCandidate.experienceYears ? ` · ${selectedCandidate.experienceYears} yrs exp` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      {selectedCandidate.resumeFileName && (
                        <span style={{ fontSize: 11, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>
                          Resume ready
                        </span>
                      )}
                      {selectedCandidate.generatedPrompt && (
                        <span style={{ fontSize: 11, background: "#ede9fe", color: "#7c3aed", border: "1px solid #ddd6fe", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>
                          AI prompt ready
                        </span>
                      )}
                    </div>
                  </div>
                  <Link href={`/recruiter/candidates/${selectedCandidate._id}`} style={{ fontSize: 12, color: "#7c3aed", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap", marginLeft: 8 }}>
                    View Profile →
                  </Link>
                </div>
              </div>
            )}

            {/* STEP 2: Interview Details */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...lbl, marginBottom: 12 }}>
                <span style={{ background: "#7c3aed", color: "#fff", padding: "1px 7px", borderRadius: 12, fontSize: 11, marginRight: 7 }}>2</span>
                Interview Details
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Date &amp; Time *</label>
                  <input
                    type="datetime-local"
                    required
                    style={inp}
                    value={form.datetime}
                    onChange={e => setForm(p => ({ ...p, datetime: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={lbl}>Duration</label>
                  <select style={inp} value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}>
                    <option value="20">20 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Role / Position *</label>
                <input required style={inp} placeholder="e.g. Full Stack Developer" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} />
              </div>
            </div>

            {/* STEP 2b: Meeting Link */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ ...lbl, marginBottom: 10 }}>Google Meet Link</label>
              {/* Toggle */}
              <div style={{ display: "flex", gap: 0, marginBottom: 14, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                {(["auto", "manual"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMeetingMode(mode)}
                    style={{
                      flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                      background: meetingMode === mode ? "#7c3aed" : "#f8fafc",
                      color: meetingMode === mode ? "#fff" : "#64748b",
                      transition: "all .15s",
                    }}
                  >
                    {mode === "auto" ? "Auto-generate (Google Calendar)" : "Paste my own link"}
                  </button>
                ))}
              </div>

              {meetingMode === "manual" ? (
                <div>
                  <input
                    type="url"
                    placeholder="https://meet.google.com/abc-def-ghi"
                    value={manualUrl}
                    onChange={e => setManualUrl(e.target.value)}
                    style={inp}
                  />
                  {/* Quick Access guidance */}
                  <div style={{ marginTop: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e", marginBottom: 8 }}>
                      ⚡ Before the interview — disable the waiting room
                    </div>
                    <div style={{ fontSize: 12, color: "#78350f", lineHeight: 1.7 }}>
                      <strong>Option A — Inside the meeting (easiest):</strong><br />
                      Open the Meet link → join → click the <strong>shield/lock icon</strong> in the bottom bar → turn <strong>&quot;Quick access&quot; ON</strong>. Anyone with the link (including the bot) joins directly.
                    </div>
                    <div style={{ fontSize: 12, color: "#78350f", lineHeight: 1.7, marginTop: 8 }}>
                      <strong>Option B — Meeting settings page:</strong><br />
                      Open the Meet link → before joining, click the <strong>⋮ (three dots)</strong> next to &quot;Join now&quot; → <strong>Meeting settings</strong> → toggle <strong>&quot;Quick access&quot;</strong> ON.
                    </div>
                    <div style={{ fontSize: 11, color: "#92400e", marginTop: 8, fontStyle: "italic" }}>
                      Quick access ON = bot joins automatically. Quick access OFF = bot waits and you must admit it manually.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px" }}>
                  A Google Meet link will be generated automatically via your connected Google Calendar account. The bot will join at the scheduled time.
                </div>
              )}
            </div>

            {/* STEP 3: AI Prompt (auto-handled) */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={{ ...lbl, marginBottom: 0 }}>
                  <span style={{ background: "#7c3aed", color: "#fff", padding: "1px 7px", borderRadius: 12, fontSize: 11, marginRight: 7 }}>3</span>
                  AI Interview Prompt
                </label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {promptSource === "saved" && (
                    <span style={{ fontSize: 11, background: "#ede9fe", color: "#7c3aed", border: "1px solid #ddd6fe", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>
                      From saved profile
                    </span>
                  )}
                  {promptSource === "generated" && (
                    <span style={{ fontSize: 11, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>
                      Auto-generated
                    </span>
                  )}
                  {form.candidateId && !generatingPrompt && (
                    <button
                      type="button"
                      onClick={() => autoGenerateForSchedule(form.candidateId)}
                      style={{ fontSize: 11, color: "#7c3aed", background: "none", border: "1px solid #ddd6fe", padding: "2px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
                    >
                      Regenerate
                    </button>
                  )}
                </div>
              </div>

              {generatingPrompt ? (
                <div style={{ padding: "16px", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, fontSize: 13, color: "#7c3aed", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⏳</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>Generating AI interview prompt...</div>
                    <div style={{ fontSize: 12, color: "#8b5cf6", marginTop: 2 }}>
                      Analyzing candidate profile and resume
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {!form.candidateId && (
                    <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 8, fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>
                      Select a candidate above — the AI prompt will be generated automatically from their profile and resume.
                    </div>
                  )}
                  <select
                    style={{ ...inp, marginBottom: 8, fontSize: 13 }}
                    value=""
                    onChange={e => { if (e.target.value) { setForm(p => ({ ...p, promptText: e.target.value })); setPromptSource(""); } }}
                  >
                    <option value="">— Override with a saved prompt —</option>
                    {prompts.map((p, i) => <option key={i} value={p.promptText}>{p.roleName}</option>)}
                  </select>
                  <textarea
                    rows={7}
                    style={{ ...inp, resize: "vertical", fontSize: 13, color: "#374151" }}
                    placeholder="AI interview prompt will appear here automatically..."
                    value={form.promptText}
                    onChange={e => { setForm(p => ({ ...p, promptText: e.target.value })); setPromptSource(""); }}
                  />
                </>
              )}
              <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>
                Candidate profile and resume context is automatically prepended by the bot.
              </p>
            </div>

            {alert && (
              <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 14, marginBottom: 14, background: alert.type === "success" ? "#f0fdf4" : alert.type === "error" ? "#fef2f2" : "#eff6ff", color: alert.type === "success" ? "#16a34a" : alert.type === "error" ? "#dc2626" : "#1d4ed8" }}>
                {alert.msg}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || generatingPrompt}
              style={{ width: "100%", padding: "12px 22px", background: (loading || generatingPrompt) ? "#c4b5fd" : "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: (loading || generatingPrompt) ? "not-allowed" : "pointer" }}
            >
              {loading ? "Scheduling..." : generatingPrompt ? "Wait — generating prompt..." : "Schedule & Send Invite →"}
            </button>
          </form>
        </div>

        {/* ── Scheduled Interviews list ── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 16px" }}>Scheduled Interviews</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Candidate", "Role", "Date & Time", "Attempt", "Status", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scheduled.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 40, fontSize: 14 }}>No interviews scheduled yet.</td></tr>
              ) : scheduled.map(iv => {
                const [sbg, scol] = (statusBg[iv.status] || "#f1f5f9|#64748b").split("|");
                return (
                  <tr key={iv._id}>
                    <td style={{ padding: "12px", fontSize: 14, borderBottom: "1px solid #f1f5f9" }}><strong>{iv.candidateName}</strong></td>
                    <td style={{ padding: "12px", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}>{iv.roleName}</td>
                    <td style={{ padding: "12px", fontSize: 12, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{new Date(iv.scheduledAt).toLocaleString()}</td>
                    <td style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>#{iv.attemptNumber || 1}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f1f5f9" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: sbg, color: scol }}>{iv.status}</span>
                    </td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f1f5f9" }}>
                      {iv.status === "pending" ? (
                        <button onClick={() => cancel(iv._id)} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", padding: "5px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer" }}>Cancel</button>
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
