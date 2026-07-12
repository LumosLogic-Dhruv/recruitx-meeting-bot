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
  const [alert, setAlert] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [promptAutoFilled, setPromptAutoFilled] = useState(false);

  useEffect(() => {
    const urlCandidateId = new URLSearchParams(window.location.search).get("candidateId") || "";
    Promise.all([loadCandidates(), loadPrompts(), loadScheduled()]).then(([allCandidates]) => {
      const pending = sessionStorage.getItem("pendingPrompt");
      if (pending) {
        setForm(p => ({ ...p, promptText: pending }));
        sessionStorage.removeItem("pendingPrompt");
      }
      if (urlCandidateId && allCandidates) {
        const c = allCandidates.find((x: Candidate) => x._id === urlCandidateId);
        if (c) {
          setSelectedCandidate(c);
          setForm(p => ({
            ...p,
            candidateId: urlCandidateId,
            role: c.roleName || p.role,
            promptText: pending || c.generatedPrompt || p.promptText,
          }));
          if (c.generatedPrompt && !pending) setPromptAutoFilled(true);
        }
      }
    });
  }, []);

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

  function onCandidateChange(candidateId: string) {
    const c = candidates.find(c => c._id === candidateId) || null;
    setSelectedCandidate(c);
    setPromptAutoFilled(false);
    setForm(p => ({
      ...p,
      candidateId,
      role: p.role || c?.roleName || "",
      promptText: p.promptText || c?.generatedPrompt || "",
    }));
    if (c?.generatedPrompt && !form.promptText) setPromptAutoFilled(true);
  }

  async function generatePromptFromCandidate() {
    if (!form.candidateId) return;
    setGeneratingPrompt(true);
    try {
      const res = await fetch(`${BASE}/api/candidates/${form.candidateId}/generate-prompt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Generation failed");
      setForm(p => ({ ...p, promptText: d.prompt || "" }));
    } catch (err: unknown) {
      setAlert({ msg: `Prompt generation failed: ${err instanceof Error ? err.message : "Unknown error"}`, type: "error" });
    } finally {
      setGeneratingPrompt(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setAlert({ msg: "Creating Google Meet and sending invite...", type: "info" });
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
          platform: "google_meet",
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setAlert({ msg: `Scheduled! Email sent: ${d.email_sent ? "Yes ✓" : "No — check SMTP settings"}`, type: "success" });
      setForm({ candidateId: "", datetime: "", duration: "30", role: "", promptText: "" });
      setSelectedCandidate(null);
      await Promise.all([loadCandidates(), loadScheduled()]);
    } catch (err: unknown) {
      setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" });
    } finally {
      setLoading(false); }
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this interview?")) return;
    await api(`/api/interviews/${id}/cancel`, { method: "POST" });
    loadScheduled();
  }

  const inp: React.CSSProperties = { width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 };
  const statusBg: Record<string, string> = { pending: "#eff6ff|#1d4ed8", active: "#f0fdf4|#16a34a", completed: "#f1f5f9|#64748b", cancelled: "#fef2f2|#dc2626" };

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 24px" }}>Schedule Interview</h1>
      <div style={{ display: "grid", gridTemplateColumns: "500px 1fr", gap: 24, alignItems: "start" }}>

        {/* Form */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 20px" }}>New Interview</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Candidate *</label>
              <select required style={inp} value={form.candidateId} onChange={e => onCandidateChange(e.target.value)}>
                <option value="">Select a candidate...</option>
                {candidates.map(c => {
                  const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "").replace(/_/g, " ");
                  return <option key={c._id} value={c._id}>{c.name} — {c.roleName || c.email} [{s}]</option>;
                })}
              </select>
            </div>

            {/* Candidate profile snapshot */}
            {selectedCandidate && (
              <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>{selectedCandidate.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                      {selectedCandidate.roleName || "No role set"}
                      {selectedCandidate.currentCompany ? ` · ${selectedCandidate.currentCompany}` : ""}
                      {selectedCandidate.experienceYears ? ` · ${selectedCandidate.experienceYears} yrs` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                      {selectedCandidate.resumeFileName ? `Resume: ${selectedCandidate.resumeFileName}` : "No resume uploaded"}
                      {selectedCandidate.generatedPrompt ? " · AI prompt ready" : ""}
                    </div>
                  </div>
                  <Link href={`/recruiter/candidates/${selectedCandidate._id}`} style={{ fontSize: 12, color: "#7c3aed", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}>
                    View Profile →
                  </Link>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Date &amp; Time *</label>
                <input type="datetime-local" required style={inp} value={form.datetime} onChange={e => setForm(p => ({ ...p, datetime: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Duration</label>
                <select style={inp} value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}>
                  <option value="20">20 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Role / Position *</label>
              <input required style={inp} placeholder="e.g. Full Stack Developer" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ ...lbl, marginBottom: 0 }}>System Prompt</label>
                {form.candidateId && (
                  <button
                    type="button"
                    onClick={generatePromptFromCandidate}
                    disabled={generatingPrompt}
                    style={{ fontSize: 12, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ddd6fe", padding: "4px 10px", borderRadius: 6, cursor: generatingPrompt ? "not-allowed" : "pointer", fontWeight: 600, opacity: generatingPrompt ? 0.65 : 1 }}
                  >
                    {generatingPrompt ? "Generating..." : "Generate from Resume"}
                  </button>
                )}
              </div>
              <select style={{ ...inp, marginBottom: 8 }} value="" onChange={e => { if (e.target.value) setForm(p => ({ ...p, promptText: e.target.value })); }}>
                <option value="">— Choose a saved prompt or generate —</option>
                {prompts.map((p, i) => <option key={i} value={p.promptText}>{p.roleName}</option>)}
              </select>
              <textarea
                rows={6}
                style={{ ...inp, resize: "vertical" }}
                placeholder="AI interviewer instructions... (select a candidate and click 'Generate from Resume' for a tailored prompt)"
                value={form.promptText}
                onChange={e => setForm(p => ({ ...p, promptText: e.target.value }))}
              />
              {promptAutoFilled && (
                <p style={{ fontSize: 12, color: "#059669", margin: "4px 0 0", fontWeight: 600 }}>
                  Auto-loaded from candidate&apos;s saved AI profile prompt
                </p>
              )}
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
                <Link href="/recruiter/prompts" style={{ color: "#7c3aed" }}>Manage saved prompts →</Link>
                {" · "}
                <span style={{ color: "#94a3b8" }}>Candidate profile + resume are always included automatically</span>
              </p>
            </div>

            {alert && (
              <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 14, marginBottom: 14, background: alert.type === "success" ? "#f0fdf4" : alert.type === "error" ? "#fef2f2" : "#eff6ff", color: alert.type === "success" ? "#16a34a" : alert.type === "error" ? "#dc2626" : "#1d4ed8" }}>
                {alert.msg}
              </div>
            )}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "10px 22px", background: loading ? "#c4b5fd" : "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              Schedule &amp; Send Invite
            </button>
          </form>
        </div>

        {/* Scheduled list */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 16px" }}>Scheduled Interviews</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Candidate","Role","Date & Time","Attempt","Status",""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 13px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scheduled.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 32 }}>No interviews scheduled yet.</td></tr>
              ) : scheduled.map(iv => {
                const [sbg, scol] = (statusBg[iv.status] || "#f1f5f9|#64748b").split("|");
                return (
                  <tr key={iv._id}>
                    <td style={{ padding: 13, fontSize: 14, borderBottom: "1px solid #f1f5f9" }}><strong>{iv.candidateName}</strong></td>
                    <td style={{ padding: 13, fontSize: 14, borderBottom: "1px solid #f1f5f9" }}>{iv.roleName}</td>
                    <td style={{ padding: 13, fontSize: 13, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{new Date(iv.scheduledAt).toLocaleString()}</td>
                    <td style={{ padding: 13, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>#{iv.attemptNumber || 1}</td>
                    <td style={{ padding: 13, borderBottom: "1px solid #f1f5f9" }}>
                      <span style={{ display: "inline-block", padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: sbg, color: scol }}>{iv.status}</span>
                    </td>
                    <td style={{ padding: 13, borderBottom: "1px solid #f1f5f9" }}>
                      {iv.status === "pending" ? (
                        <button onClick={() => cancel(iv._id)} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", padding: "6px 13px", fontSize: 13, borderRadius: 6, cursor: "pointer" }}>Cancel</button>
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
