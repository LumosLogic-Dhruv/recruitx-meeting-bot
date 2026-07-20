"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";
const G = "rgba(255,255,255,";

const card: React.CSSProperties = {
  background: `${G}0.05)`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.09)`, borderRadius: 14, padding: 24,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13, border: `1px solid ${G}0.12)`,
  borderRadius: 8, outline: "none", background: `${G}0.07)`, color: "#f1f5f9",
  fontFamily: "inherit", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 4,
  textTransform: "uppercase", letterSpacing: "0.05em",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#a78bfa", marginBottom: 12, marginTop: 4,
  paddingBottom: 6, borderBottom: `1px solid rgba(139,92,246,0.2)`,
  textTransform: "uppercase", letterSpacing: "0.06em",
};

interface Candidate {
  _id: string; name: string; email: string; roleName?: string;
  interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
  phone?: string; notes?: string; experienceYears?: string;
  currentCompany?: string; currentCtc?: string; expectedCtc?: string; location?: string;
}

function statusColor(s: string): [string, string] {
  const m: Record<string, [string, string]> = {
    never_invited:       [`${G}0.06)`, "#94a3b8"],
    attempt_1_scheduled: ["rgba(59,130,246,0.15)", "#93c5fd"],
    attempt_2_scheduled: ["rgba(59,130,246,0.15)", "#93c5fd"],
    cooldown:            ["rgba(245,158,11,0.15)", "#fbbf24"],
    locked:              ["rgba(239,68,68,0.15)", "#fca5a5"],
    completed:           ["rgba(16,185,129,0.15)", "#6ee7b7"],
    partial:             ["rgba(234,179,8,0.15)", "#fde047"],
    no_show:             ["rgba(245,158,11,0.15)", "#fbbf24"],
  };
  return m[s] || [`${G}0.06)`, "#94a3b8"];
}

function Badge({ c }: { c: Candidate }) {
  const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
  const [bg, color] = statusColor(s);
  const labels: Record<string, string> = {
    never_invited: "Not Invited", attempt_1_scheduled: "Scheduled",
    cooldown: c.cooldownUntil ? `Cooldown (${Math.max(0, Math.ceil((c.cooldownUntil - Date.now()) / 86400000))}d)` : "Cooldown",
    attempt_2_scheduled: "Retry Sched.", locked: "Locked",
    completed: "Completed", partial: "Partial", no_show: "No Show",
  };
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color }}>
      {labels[s] || s.replace(/_/g, " ")}
    </span>
  );
}

const emptyForm = {
  name: "", email: "", phone: "", location: "",
  role_name: "", current_company: "", current_role: "",
  experience_years: "", current_ctc: "", expected_ctc: "",
  education: "", linkedin_url: "", github_url: "", notes: "",
};

export default function AddCandidatePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [alert, setAlert] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { loadCandidates(); }, []);

  async function loadCandidates() {
    try {
      const res = await api("/api/candidates");
      const d = await res.json();
      setCandidates(d.candidates || []);
    } catch { /* ignore */ }
  }

  function setField(k: keyof typeof emptyForm, v: string) {
    setForm(p => ({ ...p, [k]: v }));
  }

  function addSkill() {
    const s = skillInput.trim();
    if (!s || skills.includes(s)) return;
    setSkills(p => [...p, s]);
    setSkillInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      setAlert({ msg: "Creating candidate profile...", type: "info" });
      const res = await fetch(`${BASE}/api/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ ...form, skills }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      const newId: string = d.id;
      if (resumeFile) {
        setAlert({ msg: "Uploading resume...", type: "info" });
        const fd = new FormData();
        fd.append("file", resumeFile);
        try {
          await fetch(`${BASE}/api/candidates/${newId}/resume`, {
            method: "POST",
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
            body: fd,
          });
        } catch { /* non-fatal */ }
      }
      setAlert({ msg: "Profile created! Opening candidate profile...", type: "success" });
      setForm(emptyForm);
      setSkills([]);
      setResumeFile(null);
      setTimeout(() => { window.location.href = `/recruiter/candidates/${newId}`; }, 700);
    } catch (err: unknown) {
      setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" });
      setLoading(false);
    }
  }

  async function deleteCand(id: string, name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    await api(`/api/candidates/${id}`, { method: "DELETE" });
    loadCandidates();
  }

  const filtered = candidates.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    (c.roleName || "").toLowerCase().includes(search.toLowerCase())
  );

  const alertColors: Record<string, [string, string]> = {
    success: ["rgba(16,185,129,0.12)", "#34d399"],
    error:   ["rgba(239,68,68,0.12)", "#f87171"],
    info:    ["rgba(59,130,246,0.12)", "#93c5fd"],
  };
  const [alertBg, alertText] = alertColors[alert?.type || "info"] || alertColors.info;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Add Candidate</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>{candidates.length} candidates total</p>
        </div>
        <Link href="/recruiter/candidates" style={{ fontSize: 13, fontWeight: 600, color: "#c4b5fd", textDecoration: "none", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", padding: "7px 16px", borderRadius: 8 }}>
          View All Candidates →
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 24, alignItems: "start" }}>

        {/* ── Add Form ── */}
        <div style={{ ...card, maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px" }}>New Candidate</h2>

          <form onSubmit={handleSubmit}>
            <p style={sectionTitle}>Basic Information</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
              <div><label style={lbl}>Full Name *</label><input style={inp} required placeholder="Jane Doe" value={form.name} onChange={e => setField("name", e.target.value)} /></div>
              <div><label style={lbl}>Email *</label><input style={inp} type="email" required placeholder="jane@example.com" value={form.email} onChange={e => setField("email", e.target.value)} /></div>
              <div><label style={lbl}>Phone</label><input style={inp} placeholder="+91 98765 43210" value={form.phone} onChange={e => setField("phone", e.target.value)} /></div>
              <div><label style={lbl}>Location</label><input style={inp} placeholder="Bangalore, India" value={form.location} onChange={e => setField("location", e.target.value)} /></div>
            </div>

            <p style={{ ...sectionTitle, marginTop: 16 }}>Professional Details</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
              <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Role Applied For</label><input style={inp} placeholder="Full Stack Developer" value={form.role_name} onChange={e => setField("role_name", e.target.value)} /></div>
              <div><label style={lbl}>Current Company</label><input style={inp} placeholder="Company name" value={form.current_company} onChange={e => setField("current_company", e.target.value)} /></div>
              <div><label style={lbl}>Current Role</label><input style={inp} placeholder="Sr. Engineer" value={form.current_role} onChange={e => setField("current_role", e.target.value)} /></div>
              <div><label style={lbl}>Years Exp</label><input style={inp} placeholder="4" value={form.experience_years} onChange={e => setField("experience_years", e.target.value)} /></div>
              <div><label style={lbl}>Education</label><input style={inp} placeholder="B.Tech CS" value={form.education} onChange={e => setField("education", e.target.value)} /></div>
              <div><label style={lbl}>Current CTC</label><input style={inp} placeholder="12 LPA" value={form.current_ctc} onChange={e => setField("current_ctc", e.target.value)} /></div>
              <div><label style={lbl}>Expected CTC</label><input style={inp} placeholder="18 LPA" value={form.expected_ctc} onChange={e => setField("expected_ctc", e.target.value)} /></div>
            </div>

            <p style={{ ...sectionTitle, marginTop: 16 }}>Online Presence</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
              <div><label style={lbl}>LinkedIn</label><input style={inp} placeholder="linkedin.com/in/..." value={form.linkedin_url} onChange={e => setField("linkedin_url", e.target.value)} /></div>
              <div><label style={lbl}>GitHub</label><input style={inp} placeholder="github.com/..." value={form.github_url} onChange={e => setField("github_url", e.target.value)} /></div>
            </div>

            <p style={{ ...sectionTitle, marginTop: 16 }}>Skills</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="Add a skill (press Enter)" value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }} />
              <button type="button" onClick={addSkill} style={{ padding: "9px 14px", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add</button>
            </div>
            {skills.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                {skills.map(s => (
                  <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                    {s}
                    <button onClick={() => setSkills(p => p.filter(x => x !== s))} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            )}

            <p style={{ ...sectionTitle, marginTop: 16 }}>Notes</p>
            <textarea rows={3} style={{ ...inp, resize: "vertical", marginBottom: 8 }} placeholder="Context about this candidate..." value={form.notes} onChange={e => setField("notes", e.target.value)} />

            <p style={{ ...sectionTitle, marginTop: 16 }}>Resume / CV</p>
            <div style={{ border: `2px dashed rgba(139,92,246,0.3)`, borderRadius: 10, padding: 16, background: "rgba(139,92,246,0.05)", textAlign: "center" }}>
              {resumeFile ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#34d399" }}>✓ {resumeFile.name}</span>
                  <button type="button" onClick={() => setResumeFile(null)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Remove</button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: "#a78bfa", fontWeight: 600, margin: "0 0 8px" }}>Upload resume for AI-powered questions</p>
                  <label style={{ display: "inline-block", padding: "7px 16px", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Select Resume (PDF, DOC, DOCX)
                    <input type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: "none" }} onChange={e => setResumeFile(e.target.files?.[0] || null)} />
                  </label>
                  <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0 0" }}>Can also be uploaded later from the candidate profile</p>
                </div>
              )}
            </div>

            {alert && (
              <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 12, marginTop: 12, background: alertBg, color: alertText, border: `1px solid ${alertText}30` }}>
                {alert.msg}
              </div>
            )}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "12px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1, marginTop: 12 }}>
              {loading ? (resumeFile ? "Uploading resume..." : "Creating...") : "Add Candidate →"}
            </button>
          </form>
        </div>

        {/* ── Candidates List ── */}
        <div style={{ ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>My Candidates</h2>
            <input style={{ ...inp, width: 220, fontSize: 12 }} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Candidate", "Role", "Experience", "Status", "Attempts", "Actions"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b", background: "rgba(255,255,255,0.03)", borderBottom: `2px solid ${G}0.09)` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
                  {search ? "No matches." : "No candidates yet."}
                </td></tr>
              ) : filtered.map(c => (
                <tr key={c._id}>
                  <td style={{ padding: "12px", fontSize: 13, borderBottom: `1px solid ${G}0.05)` }}>
                    <div style={{ fontWeight: 700, color: "#f1f5f9" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{c.email}</div>
                    {c.location && <div style={{ fontSize: 10, color: "#475569" }}>{c.location}</div>}
                  </td>
                  <td style={{ padding: "12px", fontSize: 12, borderBottom: `1px solid ${G}0.05)`, color: "#e2e8f0" }}>
                    {c.roleName || <span style={{ color: "#475569" }}>—</span>}
                    {c.currentCompany && <div style={{ fontSize: 11, color: "#64748b" }}>@ {c.currentCompany}</div>}
                  </td>
                  <td style={{ padding: "12px", fontSize: 12, borderBottom: `1px solid ${G}0.05)`, color: "#94a3b8" }}>
                    {c.experienceYears ? `${c.experienceYears} yrs` : "—"}
                    {c.expectedCtc ? <div style={{ fontSize: 11, color: "#64748b" }}>Exp: {c.expectedCtc}</div> : null}
                  </td>
                  <td style={{ padding: "12px", borderBottom: `1px solid ${G}0.05)` }}><Badge c={c} /></td>
                  <td style={{ padding: "12px", fontSize: 13, textAlign: "center", borderBottom: `1px solid ${G}0.05)`, color: "#94a3b8" }}>{c.attemptCount || 0}/2</td>
                  <td style={{ padding: "12px", borderBottom: `1px solid ${G}0.05)` }}>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      <Link href={`/recruiter/candidates/${c._id}`} style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)", padding: "4px 9px", fontSize: 11, borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Profile</Link>
                      <Link href={`/recruiter/schedule?candidateId=${c._id}`} style={{ background: "rgba(59,130,246,0.12)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.2)", padding: "4px 9px", fontSize: 11, borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Schedule</Link>
                      <button onClick={() => deleteCand(c._id, c.name)} style={{ background: "rgba(239,68,68,0.10)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)", padding: "4px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
