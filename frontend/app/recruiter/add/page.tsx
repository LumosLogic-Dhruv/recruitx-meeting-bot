"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface Candidate {
  _id: string; name: string; email: string; roleName?: string;
  interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
  phone?: string; notes?: string; experienceYears?: string;
  currentCompany?: string; currentCtc?: string; expectedCtc?: string;
  location?: string;
}

function Badge({ c }: { c: Candidate }) {
  const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
  const map: Record<string, [string, string]> = {
    never_invited:        ["#f1f5f9|#64748b", "Not Invited"],
    attempt_1_scheduled:  ["#eff6ff|#1d4ed8", "Scheduled"],
    cooldown:             ["#fff7ed|#c2410c", coolDays(c)],
    attempt_2_scheduled:  ["#eff6ff|#1d4ed8", "Retry Sched."],
    locked:               ["#fef2f2|#dc2626", "Locked"],
    completed:            ["#f0fdf4|#16a34a", "Completed"],
    partial:              ["#fefce8|#854d0e", "Partial"],
    no_show:              ["#fff7ed|#c2410c", "No Show"],
  };
  const [colors, label] = map[s] || ["#f1f5f9|#64748b", s.replace(/_/g, " ")];
  const [bg, color] = colors.split("|");
  return (
    <span style={{ display: "inline-block", padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: bg, color }}>
      {label}
    </span>
  );
}

function coolDays(c: Candidate) {
  if (!c.cooldownUntil) return "Cooldown";
  return `Cooldown (${Math.max(0, Math.ceil((c.cooldownUntil - Date.now()) / 86400000))}d)`;
}

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", fontFamily: "inherit", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#7c3aed", marginBottom: 12, marginTop: 4,
  paddingBottom: 6, borderBottom: "1px solid #ede9fe",
};

const emptyForm = {
  name: "", email: "", phone: "", location: "",
  role_name: "", current_company: "", current_role: "",
  experience_years: "", current_ctc: "", expected_ctc: "",
  education: "", linkedin_url: "", github_url: "", notes: "",
};

export default function CandidatesPage() {
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
      // Step 1: Create candidate profile
      setAlert({ msg: "Creating candidate profile...", type: "info" });
      const res = await fetch(`${BASE}/api/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ ...form, skills }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      const newId: string = d.id;

      // Step 2: Upload resume if selected
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
        } catch { /* non-fatal, recruiter can upload from profile */ }
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

  const alertColor = alert?.type === "success" ? "#f0fdf4|#16a34a" : alert?.type === "error" ? "#fef2f2|#dc2626" : "#eff6ff|#1d4ed8";
  const [alertBg, alertText] = alertColor.split("|");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Candidates</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>{candidates.length} total</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 24, alignItems: "start" }}>

        {/* ── Add Candidate Form ── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 16px" }}>Add New Candidate</h2>

          <form onSubmit={handleSubmit}>
            {/* Basic Information */}
            <p style={sectionTitle}>Basic Information</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
              <div>
                <label style={lbl}>Full Name *</label>
                <input style={inp} required placeholder="Jane Doe" value={form.name} onChange={e => setField("name", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Email *</label>
                <input style={inp} type="email" required placeholder="jane@example.com" value={form.email} onChange={e => setField("email", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Phone</label>
                <input style={inp} placeholder="+91 98765 43210" value={form.phone} onChange={e => setField("phone", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Location</label>
                <input style={inp} placeholder="Bangalore, India" value={form.location} onChange={e => setField("location", e.target.value)} />
              </div>
            </div>

            {/* Professional Details */}
            <p style={{ ...sectionTitle, marginTop: 16 }}>Professional Details</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Role Applied For</label>
                <input style={inp} placeholder="e.g. Full Stack Developer" value={form.role_name} onChange={e => setField("role_name", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Current Company</label>
                <input style={inp} placeholder="Company name" value={form.current_company} onChange={e => setField("current_company", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Current Role / Title</label>
                <input style={inp} placeholder="e.g. Senior Engineer" value={form.current_role} onChange={e => setField("current_role", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Years of Experience</label>
                <input style={inp} placeholder="e.g. 4" value={form.experience_years} onChange={e => setField("experience_years", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Education</label>
                <input style={inp} placeholder="B.Tech CS, IIT Delhi" value={form.education} onChange={e => setField("education", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Current CTC</label>
                <input style={inp} placeholder="e.g. 12 LPA" value={form.current_ctc} onChange={e => setField("current_ctc", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Expected CTC</label>
                <input style={inp} placeholder="e.g. 18 LPA" value={form.expected_ctc} onChange={e => setField("expected_ctc", e.target.value)} />
              </div>
            </div>

            {/* Online Presence */}
            <p style={{ ...sectionTitle, marginTop: 16 }}>Online Presence</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
              <div>
                <label style={lbl}>LinkedIn URL</label>
                <input style={inp} placeholder="linkedin.com/in/..." value={form.linkedin_url} onChange={e => setField("linkedin_url", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>GitHub URL</label>
                <input style={inp} placeholder="github.com/..." value={form.github_url} onChange={e => setField("github_url", e.target.value)} />
              </div>
            </div>

            {/* Skills */}
            <p style={{ ...sectionTitle, marginTop: 16 }}>Skills</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                style={{ ...inp, flex: 1 }}
                placeholder="Add a skill (press Enter)"
                value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
              />
              <button type="button" onClick={addSkill} style={{ padding: "9px 14px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                Add
              </button>
            </div>
            {skills.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                {skills.map(s => (
                  <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                    {s}
                    <button onClick={() => setSkills(p => p.filter(x => x !== s))} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Notes */}
            <p style={{ ...sectionTitle, marginTop: 16 }}>Recruiter Notes</p>
            <textarea
              rows={3}
              style={{ ...inp, resize: "vertical", marginBottom: 8 }}
              placeholder="Any relevant context about this candidate..."
              value={form.notes}
              onChange={e => setField("notes", e.target.value)}
            />

            {/* Resume Upload */}
            <p style={{ ...sectionTitle, marginTop: 16 }}>Resume / CV</p>
            <div style={{ border: "2px dashed #ddd6fe", borderRadius: 10, padding: 16, background: "#faf5ff", textAlign: "center" }}>
              {resumeFile ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>✓ {resumeFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setResumeFile(null)}
                    style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: "#7c3aed", fontWeight: 600, margin: "0 0 8px" }}>
                    Upload resume to enable AI-powered interview questions
                  </p>
                  <label style={{ display: "inline-block", padding: "8px 18px", background: "#7c3aed", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Select Resume (PDF, DOC, DOCX)
                    <input
                      type="file"
                      accept=".pdf,.txt,.doc,.docx"
                      style={{ display: "none" }}
                      onChange={e => setResumeFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <p style={{ fontSize: 11, color: "#a78bfa", margin: "6px 0 0" }}>Can also be uploaded later from the candidate profile</p>
                </div>
              )}
            </div>

            {alert && (
              <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 12, marginTop: 12, background: alertBg, color: alertText }}>
                {alert.msg}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: "12px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1, marginTop: 12 }}
            >
              {loading ? (resumeFile ? "Uploading resume..." : "Creating profile...") : "Add Candidate →"}
            </button>
          </form>
        </div>

        {/* ── Candidates List ── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: 0 }}>My Candidates</h2>
            <input
              style={{ ...inp, width: 220, fontSize: 13 }}
              placeholder="Search by name, email, role..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Candidate", "Role", "Experience / CTC", "Status", "Attempts", "Actions"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
                  {search ? "No candidates match your search." : "No candidates yet. Add one using the form."}
                </td></tr>
              ) : filtered.map(c => (
                <tr key={c._id} style={{ transition: "background .1s" }}>
                  <td style={{ padding: "12px", fontSize: 14, borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{c.email}</div>
                    {c.location && <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.location}</div>}
                  </td>
                  <td style={{ padding: "12px", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}>
                    {c.roleName || <span style={{ color: "#94a3b8" }}>—</span>}
                    {c.currentCompany && <div style={{ fontSize: 11, color: "#64748b" }}>@ {c.currentCompany}</div>}
                  </td>
                  <td style={{ padding: "12px", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}>
                    {c.experienceYears ? <div>{c.experienceYears} yrs exp</div> : null}
                    {c.expectedCtc ? <div style={{ fontSize: 11, color: "#64748b" }}>Exp: {c.expectedCtc}</div> : null}
                    {!c.experienceYears && !c.expectedCtc ? <span style={{ color: "#94a3b8" }}>—</span> : null}
                  </td>
                  <td style={{ padding: "12px", borderBottom: "1px solid #f1f5f9" }}><Badge c={c} /></td>
                  <td style={{ padding: "12px", fontSize: 14, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>{c.attemptCount || 0}/2</td>
                  <td style={{ padding: "12px", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Link
                        href={`/recruiter/candidates/${c._id}`}
                        style={{ background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe", padding: "5px 10px", fontSize: 12, borderRadius: 6, textDecoration: "none", fontWeight: 600 }}
                      >
                        Profile
                      </Link>
                      <Link
                        href={`/recruiter/schedule?candidateId=${c._id}`}
                        style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", padding: "5px 10px", fontSize: 12, borderRadius: 6, textDecoration: "none", fontWeight: 600 }}
                      >
                        Schedule
                      </Link>
                      <button
                        onClick={() => deleteCand(c._id, c.name)}
                        style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer" }}
                      >
                        Delete
                      </button>
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
