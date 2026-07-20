"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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

interface TimelineEvent {
  _id: string; eventType: string; timestamp: number; actor?: string; metadata?: Record<string, unknown>;
}
interface Candidate {
  _id: string; name: string; email: string; roleName?: string; interviewStatus?: string;
  resumeFileName?: string; resumeText?: string; attemptCount?: number; phone?: string; notes?: string;
  experienceYears?: string; currentCompany?: string; currentRole?: string; currentCtc?: string;
  expectedCtc?: string; location?: string; skills?: string[]; education?: string;
  linkedinUrl?: string; githubUrl?: string; generatedPrompt?: string;
}

const EVENT_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  candidate_added:      { icon: "👤", label: "Candidate Added",        color: "#a78bfa" },
  resume_uploaded:      { icon: "📄", label: "Resume Uploaded",        color: "#60a5fa" },
  interview_scheduled:  { icon: "📅", label: "Interview Scheduled",    color: "#22d3ee" },
  email_invite_sent:    { icon: "📧", label: "Invitation Email Sent",  color: "#34d399" },
  email_reminder_24h:   { icon: "⏰", label: "24h Reminder Sent",      color: "#fbbf24" },
  email_reminder_1h:    { icon: "🔔", label: "1h Reminder Sent",       color: "#f97316" },
  bot_joined:           { icon: "🤖", label: "AI Bot Joined Meeting",  color: "#a78bfa" },
  bot_join_failed:      { icon: "⚠️", label: "Bot Join Failed",        color: "#f87171" },
  candidate_joined:     { icon: "🟢", label: "Candidate Joined",       color: "#34d399" },
  candidate_left:       { icon: "🔴", label: "Candidate Left",         color: "#f87171" },
  candidate_rejoined:   { icon: "🔄", label: "Candidate Rejoined",     color: "#38bdf8" },
  interview_started:    { icon: "▶️",  label: "Interview Started",      color: "#a78bfa" },
  interview_ended:      { icon: "⏹️",  label: "Interview Ended",       color: "#94a3b8" },
  no_show:              { icon: "🚫", label: "No Show",                color: "#f87171" },
  score_generated:      { icon: "📊", label: "Score Generated",        color: "#34d399" },
  scorecard_email_sent: { icon: "📨", label: "Scorecard Email Sent",   color: "#34d399" },
  recruiter_email_sent: { icon: "📨", label: "Recruiter Notified",     color: "#60a5fa" },
  cooldown_started:     { icon: "🕐", label: "7-Day Cooldown Started", color: "#fbbf24" },
  retry_enabled:        { icon: "🔁", label: "Retry Enabled",          color: "#a78bfa" },
  retry_scheduled:      { icon: "📅", label: "Retry Scheduled",        color: "#22d3ee" },
  final_result:         { icon: "🏁", label: "Final Result",           color: "#34d399" },
  interview_cancelled:  { icon: "❌", label: "Interview Cancelled",    color: "#f87171" },
};

type Tab = "profile" | "timeline";

export default function CandidateDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [profileForm, setProfileForm] = useState<Partial<Candidate>>({});
  const [skillInput, setSkillInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [candRes, tlRes] = await Promise.all([
        api(`/api/candidates/${id}`).then(r => r.json()),
        api(`/api/candidates/${id}/timeline`).then(r => r.json()),
      ]);
      const c: Candidate = candRes.candidate;
      setCandidate(c);
      setGeneratedPrompt(c.generatedPrompt || "");
      setProfileForm({
        name: c.name || "", email: c.email || "", phone: c.phone || "",
        roleName: c.roleName || "", experienceYears: c.experienceYears || "",
        currentCompany: c.currentCompany || "", currentRole: c.currentRole || "",
        currentCtc: c.currentCtc || "", expectedCtc: c.expectedCtc || "",
        location: c.location || "", skills: c.skills || [],
        education: c.education || "", linkedinUrl: c.linkedinUrl || "",
        githubUrl: c.githubUrl || "", notes: c.notes || "",
      });
      setEvents(tlRes.timeline || []);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  function setField(key: keyof Candidate, value: string) {
    setProfileForm(prev => ({ ...prev, [key]: value }));
  }

  function addSkill() {
    const s = skillInput.trim();
    if (!s) return;
    const existing = (profileForm.skills || []) as string[];
    if (!existing.includes(s)) setProfileForm(prev => ({ ...prev, skills: [...existing, s] }));
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setProfileForm(prev => ({ ...prev, skills: ((prev.skills || []) as string[]).filter(s => s !== skill) }));
  }

  async function saveProfile() {
    if (!id) return;
    setSavingProfile(true); setProfileMsg(null);
    try {
      const res = await fetch(`${BASE}/api/candidates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({
          name: profileForm.name, email: profileForm.email, phone: profileForm.phone,
          role_name: profileForm.roleName, experience_years: profileForm.experienceYears,
          current_company: profileForm.currentCompany, current_role: profileForm.currentRole,
          current_ctc: profileForm.currentCtc, expected_ctc: profileForm.expectedCtc,
          location: profileForm.location, skills: profileForm.skills || [],
          education: profileForm.education, linkedin_url: profileForm.linkedinUrl,
          github_url: profileForm.githubUrl, notes: profileForm.notes,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed to save");
      setProfileMsg({ text: "Profile saved successfully.", ok: true });
      await loadData();
    } catch (err: unknown) {
      setProfileMsg({ text: err instanceof Error ? err.message : "Error", ok: false });
    } finally { setSavingProfile(false); }
  }

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true); setUploadMsg("Uploading...");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${BASE}/api/candidates/${id}/resume`, {
        method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Upload failed");
      setUploadMsg(`Stored: ${d.fileName} (${d.charCount} chars)`);
      await loadData();
    } catch (err: unknown) { setUploadMsg(err instanceof Error ? err.message : "Error"); }
    finally { setUploading(false); }
  }

  async function generatePrompt() {
    if (!id) return;
    setGeneratingPrompt(true); setGeneratedPrompt("");
    try {
      const res = await fetch(`${BASE}/api/candidates/${id}/generate-prompt`, {
        method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Generation failed");
      setGeneratedPrompt(d.prompt || "");
    } catch (err: unknown) {
      setGeneratedPrompt(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally { setGeneratingPrompt(false); }
  }

  function copyPromptToSchedule() {
    if (generatedPrompt) { sessionStorage.setItem("pendingPrompt", generatedPrompt); window.location.href = "/recruiter/schedule"; }
  }

  if (loading) return <div style={{ padding: 40, color: "#64748b" }}>Loading...</div>;
  if (!candidate) return <div style={{ padding: 40, color: "#f87171" }}>Candidate not found.</div>;

  const skills = (profileForm.skills || []) as string[];

  return (
    <>
      {/* Nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <Link href="/recruiter/candidates" style={{ fontSize: 13, color: "#a78bfa", textDecoration: "none", fontWeight: 600 }}>← Candidates</Link>
        <Link href={`/recruiter/schedule?candidateId=${id}`} style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", padding: "8px 18px", borderRadius: 8, textDecoration: "none" }}>
          Schedule Interview →
        </Link>
      </div>

      {/* Header card */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: "0 0 4px" }}>{candidate.name}</h1>
            <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
              {candidate.email}
              {candidate.roleName ? ` · ${candidate.roleName}` : ""}
              {candidate.attemptCount ? ` · Attempt ${candidate.attemptCount}/2` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { n: 1, label: "Profile ✓", done: true },
              { n: 2, label: candidate.resumeFileName ? "Resume ✓" : "No Resume", done: !!candidate.resumeFileName },
              { n: 3, label: candidate.generatedPrompt ? "AI Prompt ✓" : "No Prompt", done: !!candidate.generatedPrompt },
              { n: 4, label: "Schedule", done: false },
            ].map(step => (
              <div key={step.n} style={{
                display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: step.done ? "rgba(52,211,153,0.12)" : `${G}0.05)`,
                color: step.done ? "#34d399" : "#64748b",
                border: `1px solid ${step.done ? "rgba(52,211,153,0.2)" : `${G}0.09)`}`,
              }}>
                <span>{step.n}</span><span>{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Resume row */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${G}0.07)`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>Resume:</span>
          {candidate.resumeFileName && <span style={{ fontSize: 12, color: "#34d399", fontWeight: 600 }}>✓ {candidate.resumeFileName}</span>}
          <label style={{ display: "inline-block", padding: "5px 13px", background: candidate.resumeFileName ? `${G}0.07)` : "rgba(139,92,246,0.15)", color: candidate.resumeFileName ? "#e2e8f0" : "#c4b5fd", border: `1px solid ${candidate.resumeFileName ? `${G}0.12)` : "rgba(139,92,246,0.25)"}`, borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {uploading ? "Uploading..." : candidate.resumeFileName ? "Replace Resume" : "Upload Resume"}
            <input type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: "none" }} onChange={handleResumeUpload} disabled={uploading} />
          </label>
          {uploadMsg && <span style={{ fontSize: 11, color: "#34d399" }}>{uploadMsg}</span>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `2px solid ${G}0.09)`, alignItems: "flex-end" }}>
        {(["profile", "timeline"] as Tab[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "10px 20px", fontSize: 13, fontWeight: 600, border: "none",
            background: "none", cursor: "pointer",
            borderBottom: activeTab === tab ? "2px solid #8b5cf6" : "2px solid transparent",
            color: activeTab === tab ? "#c4b5fd" : "#64748b", marginBottom: -2, textTransform: "capitalize",
          }}>
            {tab === "profile" ? "Candidate Profile" : "Interview Timeline"}
          </button>
        ))}
        <Link href="/recruiter/scorecards" style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, color: "#64748b", textDecoration: "none", marginBottom: -2, borderBottom: "2px solid transparent", marginLeft: "auto" }}>
          View Scorecards →
        </Link>
      </div>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={card}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Basic Information</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { key: "name", label: "Full Name", ph: "Jane Doe" },
                  { key: "email", label: "Email", ph: "jane@example.com" },
                  { key: "phone", label: "Phone", ph: "+91 98765 43210" },
                  { key: "location", label: "Location", ph: "Bangalore, India" },
                  { key: "roleName", label: "Role Applied For", ph: "Full Stack Developer" },
                  { key: "linkedinUrl", label: "LinkedIn", ph: "linkedin.com/in/..." },
                  { key: "githubUrl", label: "GitHub", ph: "github.com/..." },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label style={lbl}>{label}</label>
                    <input style={inp} placeholder={ph} value={(profileForm[key as keyof Candidate] as string) || ""} onChange={e => setField(key as keyof Candidate, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>

            <div style={card}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Professional Details</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { key: "experienceYears", label: "Years Exp", ph: "4" },
                  { key: "currentCompany", label: "Current Company", ph: "Company" },
                  { key: "currentRole", label: "Current Role", ph: "Sr. Engineer" },
                  { key: "currentCtc", label: "Current CTC", ph: "12 LPA" },
                  { key: "expectedCtc", label: "Expected CTC", ph: "18 LPA" },
                  { key: "education", label: "Education", ph: "B.Tech CS, IIT Delhi" },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label style={lbl}>{label}</label>
                    <input style={inp} placeholder={ph} value={(profileForm[key as keyof Candidate] as string) || ""} onChange={e => setField(key as keyof Candidate, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={card}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Skills</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input style={{ ...inp, flex: 1 }} placeholder="Add a skill (e.g. React, Python)" value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }} />
                <button onClick={addSkill} style={{ padding: "9px 16px", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 40 }}>
                {skills.length === 0 && <span style={{ fontSize: 12, color: "#64748b" }}>No skills added yet</span>}
                {skills.map(skill => (
                  <span key={skill} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                    {skill}
                    <button onClick={() => removeSkill(skill)} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            </div>

            <div style={card}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Recruiter Notes</h2>
              <textarea rows={4} style={{ ...inp, resize: "vertical" }} placeholder="Any relevant context about this candidate..." value={(profileForm.notes as string) || ""} onChange={e => setField("notes", e.target.value)} />
            </div>

            {profileMsg && (
              <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 13, background: profileMsg.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: profileMsg.ok ? "#34d399" : "#f87171", border: `1px solid ${profileMsg.ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                {profileMsg.text}
              </div>
            )}
            <button onClick={saveProfile} disabled={savingProfile} style={{ padding: "11px 22px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: savingProfile ? "not-allowed" : "pointer", opacity: savingProfile ? 0.65 : 1 }}>
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>

            {/* AI Prompt */}
            <div style={{ ...card, borderColor: "rgba(139,92,246,0.25)", background: "rgba(139,92,246,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <h2 style={{ fontSize: 13, fontWeight: 700, color: "#c4b5fd", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>AI Interview Prompt</h2>
                {candidate.generatedPrompt && <span style={{ fontSize: 10, fontWeight: 700, color: "#34d399", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.2)", padding: "2px 8px", borderRadius: 20 }}>Saved to Profile</span>}
              </div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px", lineHeight: 1.5 }}>
                {candidate.resumeFileName ? `Resume: ${candidate.resumeFileName}. ` : ""}
                Generate a tailored prompt from resume + profile.
              </p>
              <button onClick={generatePrompt} disabled={generatingPrompt} style={{ padding: "8px 16px", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: generatingPrompt ? "not-allowed" : "pointer", opacity: generatingPrompt ? 0.65 : 1 }}>
                {generatingPrompt ? "Generating..." : candidate.generatedPrompt ? "Regenerate Prompt" : "Generate AI Prompt from Profile"}
              </button>
              {generatedPrompt && (
                <>
                  <div style={{ fontSize: 11, color: "#34d399", marginTop: 8, marginBottom: 4 }}>Prompt generated and saved. Auto-loads when scheduling.</div>
                  <textarea readOnly rows={8} value={generatedPrompt} style={{ ...inp, background: `${G}0.04)`, resize: "vertical", fontSize: 12, lineHeight: 1.5, marginTop: 4 }} />
                  <button onClick={copyPromptToSchedule} style={{ marginTop: 8, padding: "8px 16px", background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Use in Schedule Interview →
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Timeline Tab */}
      {activeTab === "timeline" && (
        <div style={card}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 24px" }}>Interview Timeline</h2>
          {events.length === 0 ? (
            <p style={{ color: "#64748b", textAlign: "center", padding: 40 }}>No events recorded yet.</p>
          ) : (
            <div style={{ position: "relative", paddingLeft: 32 }}>
              <div style={{ position: "absolute", left: 11, top: 0, bottom: 0, width: 2, background: "rgba(139,92,246,0.2)" }} />
              {events.map((ev, idx) => {
                const def = EVENT_LABELS[ev.eventType] || { icon: "•", label: ev.eventType, color: "#64748b" };
                const dt = new Date(ev.timestamp);
                return (
                  <div key={ev._id} style={{ position: "relative", marginBottom: idx === events.length - 1 ? 0 : 24 }}>
                    <div style={{
                      position: "absolute", left: -32, top: 2, width: 22, height: 22, borderRadius: "50%",
                      background: `rgba(${def.color === "#a78bfa" ? "167,139,250" : "99,102,241"},0.15)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, border: `1.5px solid ${def.color}40`,
                    }}>
                      {def.icon}
                    </div>
                    <div style={{ background: `${G}0.04)`, border: `1px solid ${G}0.08)`, borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: def.color }}>{def.label}</span>
                        <span style={{ fontSize: 10, color: "#64748b" }}>
                          {dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {ev.metadata && (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {!!ev.metadata.overallScore && <span style={{ fontSize: 10, background: "rgba(52,211,153,0.12)", color: "#34d399", padding: "1px 7px", borderRadius: 20, fontWeight: 700 }}>Score: {String(ev.metadata.overallScore)}/10</span>}
                          {!!ev.metadata.recommendation && <span style={{ fontSize: 10, background: "rgba(139,92,246,0.12)", color: "#a78bfa", padding: "1px 7px", borderRadius: 20, fontWeight: 700 }}>{String(ev.metadata.recommendation)}</span>}
                          {!!ev.metadata.attemptNumber && <span style={{ fontSize: 10, background: "rgba(96,165,250,0.12)", color: "#93c5fd", padding: "1px 7px", borderRadius: 20, fontWeight: 700 }}>Attempt {String(ev.metadata.attemptNumber)}</span>}
                          {!!ev.metadata.fileName && <span style={{ fontSize: 10, background: `${G}0.07)`, color: "#94a3b8", padding: "1px 7px", borderRadius: 20, fontWeight: 600 }}>{String(ev.metadata.fileName)}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
