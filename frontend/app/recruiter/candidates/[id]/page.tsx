"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface TimelineEvent {
  _id: string;
  eventType: string;
  timestamp: number;
  actor?: string;
  metadata?: Record<string, unknown>;
}

interface Candidate {
  _id: string;
  name: string;
  email: string;
  roleName?: string;
  interviewStatus?: string;
  resumeFileName?: string;
  resumeText?: string;
  attemptCount?: number;
  phone?: string;
  notes?: string;
  experienceYears?: string;
  currentCompany?: string;
  currentRole?: string;
  currentCtc?: string;
  expectedCtc?: string;
  location?: string;
  skills?: string[];
  education?: string;
  linkedinUrl?: string;
  githubUrl?: string;
}

const EVENT_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  candidate_added:      { icon: "👤", label: "Candidate Added",          color: "#7c3aed" },
  resume_uploaded:      { icon: "📄", label: "Resume Uploaded",          color: "#2563eb" },
  interview_scheduled:  { icon: "📅", label: "Interview Scheduled",      color: "#0891b2" },
  email_invite_sent:    { icon: "📧", label: "Invitation Email Sent",    color: "#059669" },
  email_reminder_24h:   { icon: "⏰", label: "24h Reminder Sent",        color: "#d97706" },
  email_reminder_1h:    { icon: "🔔", label: "1h Reminder Sent",         color: "#ea580c" },
  bot_joined:           { icon: "🤖", label: "AI Bot Joined Meeting",    color: "#7c3aed" },
  bot_join_failed:      { icon: "⚠️", label: "Bot Join Failed",          color: "#dc2626" },
  candidate_joined:     { icon: "🟢", label: "Candidate Joined",         color: "#16a34a" },
  candidate_left:       { icon: "🔴", label: "Candidate Left",           color: "#dc2626" },
  candidate_rejoined:   { icon: "🔄", label: "Candidate Rejoined",       color: "#0284c7" },
  interview_started:    { icon: "▶️",  label: "Interview Started",        color: "#7c3aed" },
  interview_ended:      { icon: "⏹️",  label: "Interview Ended",         color: "#64748b" },
  no_show:              { icon: "🚫", label: "No Show",                  color: "#dc2626" },
  score_generated:      { icon: "📊", label: "Score Generated",          color: "#16a34a" },
  scorecard_email_sent: { icon: "📨", label: "Scorecard Email Sent",     color: "#059669" },
  recruiter_email_sent: { icon: "📨", label: "Recruiter Notified",       color: "#2563eb" },
  cooldown_started:     { icon: "🕐", label: "7-Day Cooldown Started",   color: "#d97706" },
  retry_enabled:        { icon: "🔁", label: "Retry Enabled",            color: "#7c3aed" },
  retry_scheduled:      { icon: "📅", label: "Retry Scheduled",          color: "#0891b2" },
  final_result:         { icon: "🏁", label: "Final Result",             color: "#16a34a" },
  interview_cancelled:  { icon: "❌", label: "Interview Cancelled",      color: "#dc2626" },
};

function EventMeta({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  const entries = Object.entries(metadata).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {entries.map(([k, v]) => {
        const display = k === "overallScore" ? `Score: ${v}/10`
          : k === "recommendation" ? String(v)
          : k === "attemptNumber" ? `Attempt ${v}`
          : k === "hoursBeforeInterview" ? `${v}h before`
          : k === "charCount" ? `${v} chars`
          : k === "fileName" ? String(v)
          : null;
        if (!display) return null;
        return (
          <span key={k} style={{ background: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
            {display}
          </span>
        );
      })}
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };

type Tab = "profile" | "timeline";

export default function CandidateDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  // Profile edit state
  const [profileForm, setProfileForm] = useState<Partial<Candidate>>({});
  const [skillInput, setSkillInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Resume
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  // Prompt generation
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
      setProfileForm({
        name: c.name || "",
        email: c.email || "",
        phone: c.phone || "",
        roleName: c.roleName || "",
        experienceYears: c.experienceYears || "",
        currentCompany: c.currentCompany || "",
        currentRole: c.currentRole || "",
        currentCtc: c.currentCtc || "",
        expectedCtc: c.expectedCtc || "",
        location: c.location || "",
        skills: c.skills || [],
        education: c.education || "",
        linkedinUrl: c.linkedinUrl || "",
        githubUrl: c.githubUrl || "",
        notes: c.notes || "",
      });
      setEvents(tlRes.timeline || []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  function setField(key: keyof Candidate, value: string) {
    setProfileForm(prev => ({ ...prev, [key]: value }));
  }

  function addSkill() {
    const s = skillInput.trim();
    if (!s) return;
    const existing = (profileForm.skills || []) as string[];
    if (!existing.includes(s)) {
      setProfileForm(prev => ({ ...prev, skills: [...existing, s] }));
    }
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setProfileForm(prev => ({ ...prev, skills: ((prev.skills || []) as string[]).filter(s => s !== skill) }));
  }

  async function saveProfile() {
    if (!id) return;
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch(`${BASE}/api/candidates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({
          name: profileForm.name,
          email: profileForm.email,
          phone: profileForm.phone,
          role_name: profileForm.roleName,
          experience_years: profileForm.experienceYears,
          current_company: profileForm.currentCompany,
          current_role: profileForm.currentRole,
          current_ctc: profileForm.currentCtc,
          expected_ctc: profileForm.expectedCtc,
          location: profileForm.location,
          skills: profileForm.skills || [],
          education: profileForm.education,
          linkedin_url: profileForm.linkedinUrl,
          github_url: profileForm.githubUrl,
          notes: profileForm.notes,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed to save");
      setProfileMsg({ text: "Profile saved successfully.", ok: true });
      await loadData();
    } catch (err: unknown) {
      setProfileMsg({ text: err instanceof Error ? err.message : "Error", ok: false });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setUploadMsg("Uploading...");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${BASE}/api/candidates/${id}/resume`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Upload failed");
      setUploadMsg(`Stored: ${d.fileName} (${d.charCount} chars)`);
      await loadData();
    } catch (err: unknown) {
      setUploadMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setUploading(false);
    }
  }

  async function generatePrompt() {
    if (!id) return;
    setGeneratingPrompt(true);
    setGeneratedPrompt("");
    try {
      const res = await fetch(`${BASE}/api/candidates/${id}/generate-prompt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Generation failed");
      setGeneratedPrompt(d.prompt || "");
    } catch (err: unknown) {
      setGeneratedPrompt(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setGeneratingPrompt(false);
    }
  }

  function copyPromptToSchedule() {
    if (generatedPrompt) {
      sessionStorage.setItem("pendingPrompt", generatedPrompt);
      window.location.href = "/recruiter/schedule";
    }
  }

  if (loading) return <div style={{ padding: 40, color: "#64748b" }}>Loading...</div>;
  if (!candidate) return <div style={{ padding: 40, color: "#dc2626" }}>Candidate not found.</div>;

  const skills = (profileForm.skills || []) as string[];

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div>
          <Link href="/recruiter/add" style={{ fontSize: 13, color: "#7c3aed", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            ← Back to Candidates
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>{candidate.name}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#64748b" }}>
            {candidate.email}
            {candidate.roleName ? ` · ${candidate.roleName}` : ""}
            {candidate.attemptCount ? ` · Attempt ${candidate.attemptCount}/2` : ""}
          </p>
        </div>

        {/* Resume upload */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", minWidth: 260 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Resume / CV</div>
          {candidate.resumeFileName && (
            <div style={{ fontSize: 12, color: "#16a34a", marginBottom: 8 }}>✓ {candidate.resumeFileName}</div>
          )}
          <label style={{ display: "inline-block", padding: "8px 16px", background: "#7c3aed", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {uploading ? "Uploading..." : candidate.resumeFileName ? "Replace Resume" : "Upload Resume"}
            <input type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: "none" }} onChange={handleResumeUpload} disabled={uploading} />
          </label>
          {uploadMsg && <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{uploadMsg}</div>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e2e8f0" }}>
        {(["profile", "timeline"] as Tab[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "10px 20px", fontSize: 14, fontWeight: 600, border: "none",
            background: "none", cursor: "pointer", borderBottom: activeTab === tab ? "2px solid #7c3aed" : "2px solid transparent",
            color: activeTab === tab ? "#7c3aed" : "#64748b", marginBottom: -2, textTransform: "capitalize",
          }}>
            {tab === "profile" ? "Candidate Profile" : "Interview Timeline"}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* Left column: Basic + Professional */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#374151", margin: "0 0 18px" }}>Basic Information</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Full Name</label>
                  <input style={inp} value={profileForm.name || ""} onChange={e => setField("name", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Email</label>
                  <input style={inp} type="email" value={profileForm.email || ""} onChange={e => setField("email", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Phone</label>
                  <input style={inp} placeholder="+91 98765 43210" value={profileForm.phone || ""} onChange={e => setField("phone", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Location</label>
                  <input style={inp} placeholder="Bangalore, India" value={profileForm.location || ""} onChange={e => setField("location", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Role Applied For</label>
                  <input style={inp} placeholder="Full Stack Developer" value={profileForm.roleName || ""} onChange={e => setField("roleName", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>LinkedIn</label>
                  <input style={inp} placeholder="linkedin.com/in/..." value={profileForm.linkedinUrl || ""} onChange={e => setField("linkedinUrl", e.target.value)} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={lbl}>GitHub</label>
                  <input style={inp} placeholder="github.com/..." value={profileForm.githubUrl || ""} onChange={e => setField("githubUrl", e.target.value)} />
                </div>
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#374151", margin: "0 0 18px" }}>Professional Details</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Years of Experience</label>
                  <input style={inp} placeholder="e.g. 4" value={profileForm.experienceYears || ""} onChange={e => setField("experienceYears", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Current Company</label>
                  <input style={inp} placeholder="Company name" value={profileForm.currentCompany || ""} onChange={e => setField("currentCompany", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Current Role</label>
                  <input style={inp} placeholder="e.g. Senior Engineer" value={profileForm.currentRole || ""} onChange={e => setField("currentRole", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Current CTC</label>
                  <input style={inp} placeholder="e.g. 12 LPA" value={profileForm.currentCtc || ""} onChange={e => setField("currentCtc", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Expected CTC</label>
                  <input style={inp} placeholder="e.g. 18 LPA" value={profileForm.expectedCtc || ""} onChange={e => setField("expectedCtc", e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Education</label>
                  <input style={inp} placeholder="B.Tech CS, IIT Delhi (2020)" value={profileForm.education || ""} onChange={e => setField("education", e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Right column: Skills, Notes, Generate Prompt */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#374151", margin: "0 0 18px" }}>Skills</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  style={{ ...inp, flex: 1 }}
                  placeholder="Add a skill (e.g. React, Python)"
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                />
                <button onClick={addSkill} style={{ padding: "9px 16px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Add
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 40 }}>
                {skills.length === 0 && <span style={{ fontSize: 13, color: "#94a3b8" }}>No skills added yet</span>}
                {skills.map(skill => (
                  <span key={skill} style={{ display: "flex", alignItems: "center", gap: 6, background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                    {skill}
                    <button onClick={() => removeSkill(skill)} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#374151", margin: "0 0 18px" }}>Recruiter Notes</h2>
              <textarea
                rows={4}
                style={{ ...inp, resize: "vertical" }}
                placeholder="Any relevant context about this candidate..."
                value={profileForm.notes || ""}
                onChange={e => setField("notes", e.target.value)}
              />
            </div>

            {profileMsg && (
              <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 13, background: profileMsg.ok ? "#f0fdf4" : "#fef2f2", color: profileMsg.ok ? "#16a34a" : "#dc2626" }}>
                {profileMsg.text}
              </div>
            )}
            <button onClick={saveProfile} disabled={savingProfile} style={{ padding: "11px 22px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: savingProfile ? "not-allowed" : "pointer", opacity: savingProfile ? 0.65 : 1 }}>
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>

            {/* AI Prompt Generator */}
            <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 14, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#7c3aed", margin: "0 0 8px" }}>Generate Interview Prompt</h2>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 14px" }}>
                {candidate.resumeFileName
                  ? `Resume uploaded (${candidate.resumeFileName}). Click to generate a tailored prompt.`
                  : "Upload a resume above to get a resume-based prompt, or generate from profile fields."}
              </p>
              <button onClick={generatePrompt} disabled={generatingPrompt} style={{ padding: "9px 18px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: generatingPrompt ? "not-allowed" : "pointer", opacity: generatingPrompt ? 0.65 : 1, marginBottom: generatedPrompt ? 14 : 0 }}>
                {generatingPrompt ? "Generating..." : "Generate AI Prompt from Profile"}
              </button>
              {generatedPrompt && (
                <>
                  <textarea
                    readOnly
                    rows={8}
                    value={generatedPrompt}
                    style={{ ...inp, marginTop: 12, background: "#fff", resize: "vertical", fontSize: 12, color: "#374151" }}
                  />
                  <button onClick={copyPromptToSchedule} style={{ marginTop: 8, padding: "8px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Use This Prompt in Schedule →
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Timeline Tab */}
      {activeTab === "timeline" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 24px" }}>Interview Timeline</h2>
          {events.length === 0 ? (
            <p style={{ color: "#64748b", textAlign: "center", padding: 40 }}>No events recorded yet.</p>
          ) : (
            <div style={{ position: "relative", paddingLeft: 32 }}>
              <div style={{ position: "absolute", left: 11, top: 0, bottom: 0, width: 2, background: "#e2e8f0" }} />
              {events.map((ev, idx) => {
                const def = EVENT_LABELS[ev.eventType] || { icon: "•", label: ev.eventType, color: "#64748b" };
                const isLast = idx === events.length - 1;
                const dt = new Date(ev.timestamp);
                return (
                  <div key={ev._id} style={{ position: "relative", marginBottom: isLast ? 0 : 28 }}>
                    <div style={{
                      position: "absolute", left: -32, top: 2,
                      width: 24, height: 24, borderRadius: "50%",
                      background: def.color, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, border: "3px solid #fff", boxShadow: "0 0 0 2px #e2e8f0",
                    }}>
                      <span style={{ fontSize: 10 }}>{def.icon}</span>
                    </div>
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: def.color }}>{def.label}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          {dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          {" · "}
                          {dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <EventMeta metadata={ev.metadata} />
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
