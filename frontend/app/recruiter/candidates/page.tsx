"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import ScorecardDetailModal, { ScorecardMeeting } from "@/components/ScorecardDetailModal";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";
const G = "rgba(255,255,255,";

// ── Shared style tokens ────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: `${G}0.05)`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.09)`, borderRadius: 14,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${G}0.12)`, borderRadius: 8, outline: "none",
  background: `${G}0.07)`, color: "#f1f5f9", fontFamily: "inherit", boxSizing: "border-box",
};
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" };

// ── Extended meeting type with API fields not in ScorecardMeeting ─────────
interface MeetingRecord extends ScorecardMeeting {
  interviewStatus?: string;
  botAudioUrl?: string;
  candidateAudioUrl?: string;
}

// ── Interfaces ────────────────────────────────────────────────────────────
interface Candidate {
  _id: string; name: string; email: string; phone?: string; roleName?: string;
  interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
  currentCompany?: string; currentRole?: string; currentCtc?: string; expectedCtc?: string;
  experienceYears?: string; location?: string; skills?: string[]; education?: string;
  linkedinUrl?: string; githubUrl?: string; notes?: string;
  resumeFileName?: string; resumeText?: string; generatedPrompt?: string;
}
interface TimelineEvent {
  _id: string; eventType: string; timestamp: number; actor?: string; metadata?: Record<string, unknown>;
}

// ── Status helpers ────────────────────────────────────────────────────────
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
function statusLabel(s: string, c: Candidate) {
  const map: Record<string, string> = {
    never_invited: "Not Invited", attempt_1_scheduled: "Scheduled",
    attempt_2_scheduled: "Retry Sched.", locked: "Final/Locked",
    completed: "Completed", partial: "Partial", no_show: "No Show",
    cooldown: c.cooldownUntil
      ? `Cooldown (${Math.max(0, Math.ceil((c.cooldownUntil - Date.now()) / 86400000))}d)`
      : "Cooldown",
  };
  return map[s] || s.replace(/_/g, " ");
}

const EVENT_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  candidate_added:      { icon: "👤", label: "Candidate Added",         color: "#a78bfa" },
  resume_uploaded:      { icon: "📄", label: "Resume Uploaded",         color: "#60a5fa" },
  interview_scheduled:  { icon: "📅", label: "Interview Scheduled",     color: "#22d3ee" },
  email_invite_sent:    { icon: "📧", label: "Invitation Sent",         color: "#34d399" },
  email_reminder_24h:   { icon: "⏰", label: "24h Reminder",            color: "#fbbf24" },
  email_reminder_1h:    { icon: "🔔", label: "1h Reminder",             color: "#f97316" },
  bot_joined:           { icon: "🤖", label: "AI Bot Joined",           color: "#a78bfa" },
  bot_join_failed:      { icon: "⚠️", label: "Bot Join Failed",         color: "#f87171" },
  candidate_joined:     { icon: "🟢", label: "Candidate Joined",        color: "#34d399" },
  candidate_left:       { icon: "🔴", label: "Candidate Left",          color: "#f87171" },
  candidate_rejoined:   { icon: "🔄", label: "Candidate Rejoined",      color: "#38bdf8" },
  interview_started:    { icon: "▶️",  label: "Interview Started",       color: "#a78bfa" },
  interview_ended:      { icon: "⏹️",  label: "Interview Ended",        color: "#94a3b8" },
  no_show:              { icon: "🚫", label: "No Show",                 color: "#f87171" },
  score_generated:      { icon: "📊", label: "Score Generated",         color: "#34d399" },
  scorecard_email_sent: { icon: "📨", label: "Scorecard Sent",          color: "#34d399" },
  recruiter_email_sent: { icon: "📨", label: "Recruiter Notified",      color: "#60a5fa" },
  cooldown_started:     { icon: "🕐", label: "7-Day Cooldown",          color: "#fbbf24" },
  retry_enabled:        { icon: "🔁", label: "Retry Enabled",           color: "#a78bfa" },
  retry_scheduled:      { icon: "📅", label: "Retry Scheduled",         color: "#22d3ee" },
  final_result:         { icon: "🏁", label: "Final Result",            color: "#34d399" },
  interview_cancelled:  { icon: "❌", label: "Interview Cancelled",     color: "#f87171" },
};

// ── Sub-components ────────────────────────────────────────────────────────
function StatusBadge({ c }: { c: Candidate }) {
  const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
  const [bg, col] = statusColor(s);
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color: col }}>
      {statusLabel(s, c)}
    </span>
  );
}

function ScoreChip({ score }: { score: number }) {
  const col = score >= 7 ? "#34d399" : score >= 5 ? "#fbbf24" : "#f87171";
  return (
    <span style={{ background: `rgba(${score >= 7 ? "52,211,153" : score >= 5 ? "251,191,36" : "248,113,113"},0.15)`, color: col, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>
      {score}/10
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"profile" | "timeline" | "interviews">("profile");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [modal, setModal] = useState<MeetingRecord[] | null>(null);

  // Profile edit
  const [profileForm, setProfileForm] = useState<Partial<Candidate>>({});
  const [skillInput, setSkillInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Resume
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  // Prompt
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");

  useEffect(() => { loadCandidates(); }, []);

  async function loadCandidates() {
    const r = await api("/api/candidates");
    const d = await r.json();
    setCandidates(d.candidates || []);
  }

  const loadDetail = useCallback(async (c: Candidate) => {
    setSelected(c);
    setActiveTab("profile");
    setProfileMsg(null);
    setUploadMsg("");
    setLoadingDetail(true);
    setGeneratedPrompt(c.generatedPrompt || "");
    setProfileForm({
      name: c.name, email: c.email, phone: c.phone || "",
      roleName: c.roleName || "", experienceYears: c.experienceYears || "",
      currentCompany: c.currentCompany || "", currentRole: c.currentRole || "",
      currentCtc: c.currentCtc || "", expectedCtc: c.expectedCtc || "",
      location: c.location || "", skills: c.skills || [], education: c.education || "",
      linkedinUrl: c.linkedinUrl || "", githubUrl: c.githubUrl || "", notes: c.notes || "",
    });
    try {
      const [tlRes, meetRes] = await Promise.all([
        api(`/api/candidates/${c._id}/timeline`).then(r => r.json()).catch(() => ({ timeline: [] })),
        api("/api/meetings").then(r => r.json()).catch(() => ({ meetings: [] })),
      ]);
      setEvents(tlRes.timeline || []);
      const allMeetings: MeetingRecord[] = meetRes.meetings || [];
      setMeetings(allMeetings.filter(m => m.candidateName === c.name));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  async function saveProfile() {
    if (!selected) return;
    setSavingProfile(true); setProfileMsg(null);
    try {
      const res = await fetch(`${BASE}/api/candidates/${selected._id}`, {
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
      if (!res.ok) throw new Error(d.detail || "Save failed");
      setProfileMsg({ text: "Profile saved.", ok: true });
      await loadCandidates();
    } catch (e: unknown) {
      setProfileMsg({ text: e instanceof Error ? e.message : "Error", ok: false });
    } finally { setSavingProfile(false); }
  }

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setUploading(true); setUploadMsg("Uploading...");
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`${BASE}/api/candidates/${selected._id}/resume`, {
        method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Upload failed");
      setUploadMsg(`Uploaded: ${d.fileName}`);
      const updated = { ...selected, resumeFileName: d.fileName };
      setSelected(updated);
      setCandidates(prev => prev.map(c => c._id === selected._id ? updated : c));
    } catch (e: unknown) {
      setUploadMsg(e instanceof Error ? e.message : "Error");
    } finally { setUploading(false); }
  }

  async function generatePrompt() {
    if (!selected) return;
    setGeneratingPrompt(true); setGeneratedPrompt("");
    try {
      const res = await fetch(`${BASE}/api/candidates/${selected._id}/generate-prompt`, {
        method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Generation failed");
      setGeneratedPrompt(d.prompt || "");
    } catch (e: unknown) {
      setGeneratedPrompt(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally { setGeneratingPrompt(false); }
  }

  const filtered = candidates.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
      || (c.roleName || "").toLowerCase().includes(q) || (c.currentCompany || "").toLowerCase().includes(q);
    const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
    const matchStatus = !statusFilter || s === statusFilter;
    return matchSearch && matchStatus;
  });

  const skills = (profileForm.skills || []) as string[];

  function addSkill() {
    const s = skillInput.trim();
    if (!s || skills.includes(s)) return;
    setProfileForm(p => ({ ...p, skills: [...skills, s] }));
    setSkillInput("");
  }

  return (
    <div style={{ display: "flex", gap: 0, height: "calc(100vh - 64px)" }}>

      {/* ── Sidebar: Candidate List ── */}
      <div style={{
        width: 320, flexShrink: 0, display: "flex", flexDirection: "column",
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14, overflow: "hidden", marginRight: 20,
      }}>
        {/* Search + Filter Header */}
        <div style={{ padding: "16px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
              Candidates <span style={{ color: "#64748b", fontWeight: 500, fontSize: 12 }}>({filtered.length})</span>
            </span>
            <Link href="/recruiter/add" style={{
              fontSize: 11, fontWeight: 700, color: "#c4b5fd", textDecoration: "none",
              background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)",
              padding: "4px 10px", borderRadius: 20,
            }}>+ Add</Link>
          </div>
          <input
            style={{ ...inp, marginBottom: 8 }}
            placeholder="Search by name, role, company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            style={{ ...inp, fontSize: 12 }}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="never_invited">Not Invited</option>
            <option value="attempt_1_scheduled">Interview Scheduled</option>
            <option value="cooldown">In Cooldown</option>
            <option value="attempt_2_scheduled">Retry Scheduled</option>
            <option value="completed">Completed</option>
            <option value="locked">Final/Locked</option>
            <option value="no_show">No Show</option>
          </select>
        </div>

        {/* Candidate list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#64748b", fontSize: 13 }}>
              {search || statusFilter ? "No matches" : "No candidates yet"}
            </div>
          ) : filtered.map(c => {
            const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
            const [bg, col] = statusColor(s);
            const isSelected = selected?._id === c._id;
            return (
              <button
                key={c._id}
                onClick={() => loadDetail(c)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "12px 14px",
                  background: isSelected ? "rgba(139,92,246,0.10)" : "transparent",
                  borderLeft: `3px solid ${isSelected ? "#8b5cf6" : "transparent"}`,
                  border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)",
                  cursor: "pointer", transition: "all .12s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "#c4b5fd" : "#e2e8f0" }}>{c.name}</span>
                  <span style={{ background: bg, color: col, padding: "2px 7px", borderRadius: 20, fontSize: 9, fontWeight: 700, flexShrink: 0, marginLeft: 6 }}>
                    {statusLabel(s, c)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {c.roleName || "No role"}{c.currentCompany ? ` · ${c.currentCompany}` : ""}
                </div>
                {c.experienceYears && (
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{c.experienceYears} yrs exp</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Panel ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {!selected ? (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            ...card, padding: 40, textAlign: "center",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", margin: "0 0 8px" }}>Select a Candidate</h2>
            <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px" }}>Choose a candidate from the list to view and manage their profile</p>
            <Link href="/recruiter/add" style={{
              background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff",
              padding: "10px 22px", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 700,
            }}>Add New Candidate</Link>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Header Card */}
            <div style={{ ...card, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
                <div>
                  <h1 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", margin: "0 0 4px" }}>{selected.name}</h1>
                  <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
                    {selected.email}
                    {selected.phone && ` · ${selected.phone}`}
                    {selected.roleName && ` · ${selected.roleName}`}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <StatusBadge c={selected} />
                  <span style={{ background: "rgba(255,255,255,0.07)", color: "#94a3b8", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                    {selected.attemptCount || 0}/2 attempts
                  </span>
                  <Link href={`/recruiter/schedule?candidateId=${selected._id}`} style={{
                    background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff",
                    padding: "6px 16px", borderRadius: 8, textDecoration: "none", fontSize: 12, fontWeight: 700,
                  }}>Schedule →</Link>
                </div>
              </div>

              {/* Workflow chips */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                {[
                  { n: 1, label: "Profile", done: true, color: "#34d399" },
                  { n: 2, label: "Resume", done: !!selected.resumeFileName, color: "#34d399" },
                  { n: 3, label: "AI Prompt", done: !!selected.generatedPrompt, color: "#a78bfa" },
                  { n: 4, label: "Interview", done: (selected.attemptCount || 0) > 0, color: "#60a5fa" },
                  { n: 5, label: "Scored", done: meetings.some(m => m.scorecard?.overall_score), color: "#fbbf24" },
                ].map(step => (
                  <div key={step.n} style={{
                    display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20,
                    background: step.done ? `rgba(${step.color === "#34d399" ? "52,211,153" : step.color === "#a78bfa" ? "167,139,250" : step.color === "#60a5fa" ? "96,165,250" : "251,191,36"},0.12)` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${step.done ? `rgba(${step.color === "#34d399" ? "52,211,153" : step.color === "#a78bfa" ? "167,139,250" : step.color === "#60a5fa" ? "96,165,250" : "251,191,36"},0.25)` : "rgba(255,255,255,0.08)"}`,
                    fontSize: 11, fontWeight: 700,
                    color: step.done ? step.color : "#64748b",
                  }}>
                    {step.done ? "✓" : `${step.n}`} {step.label}
                  </div>
                ))}
                {/* Resume upload */}
                <label style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, cursor: uploading ? "not-allowed" : "pointer",
                  background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)",
                  fontSize: 11, fontWeight: 700, color: "#c4b5fd",
                }}>
                  {uploading ? "Uploading…" : selected.resumeFileName ? "Replace Resume" : "Upload Resume"}
                  <input type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: "none" }} onChange={handleResumeUpload} disabled={uploading} />
                </label>
                {uploadMsg && <span style={{ fontSize: 11, color: "#34d399" }}>{uploadMsg}</span>}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 0 }}>
              {(["profile", "timeline", "interviews"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: "9px 18px", fontSize: 13, fontWeight: 600, border: "none",
                  background: "none", cursor: "pointer",
                  borderBottom: activeTab === tab ? "2px solid #8b5cf6" : "2px solid transparent",
                  color: activeTab === tab ? "#c4b5fd" : "#94a3b8",
                  textTransform: "capitalize", transition: "all .15s",
                }}>
                  {tab === "profile" ? "Profile" : tab === "timeline" ? "Timeline" : `Interviews (${meetings.length})`}
                </button>
              ))}
            </div>

            {loadingDetail && (
              <div style={{ color: "#64748b", fontSize: 13, padding: "20px 0" }}>Loading...</div>
            )}

            {/* ── Profile Tab ── */}
            {!loadingDetail && activeTab === "profile" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

                {/* Left: Basic + Professional */}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ ...card, padding: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Basic Info</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {[
                        { key: "name", label: "Full Name", ph: "Jane Doe" },
                        { key: "email", label: "Email", ph: "jane@example.com" },
                        { key: "phone", label: "Phone", ph: "+91 98765 43210" },
                        { key: "location", label: "Location", ph: "Bangalore, India" },
                        { key: "roleName", label: "Role Applied For", ph: "Full Stack Developer" },
                        { key: "education", label: "Education", ph: "B.Tech CS" },
                        { key: "linkedinUrl", label: "LinkedIn", ph: "linkedin.com/in/..." },
                        { key: "githubUrl", label: "GitHub", ph: "github.com/..." },
                      ].map(({ key, label, ph }) => (
                        <div key={key} style={key === "roleName" || key === "linkedinUrl" ? {} : {}}>
                          <label style={lbl}>{label}</label>
                          <input
                            style={inp}
                            placeholder={ph}
                            value={(profileForm[key as keyof Candidate] as string) || ""}
                            onChange={e => setProfileForm(p => ({ ...p, [key]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ ...card, padding: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Professional</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {[
                        { key: "experienceYears", label: "Years Exp", ph: "4" },
                        { key: "currentCompany", label: "Company", ph: "Infosys" },
                        { key: "currentRole", label: "Current Title", ph: "Sr. Engineer" },
                        { key: "currentCtc", label: "Current CTC", ph: "12 LPA" },
                        { key: "expectedCtc", label: "Expected CTC", ph: "18 LPA" },
                      ].map(({ key, label, ph }) => (
                        <div key={key}>
                          <label style={lbl}>{label}</label>
                          <input
                            style={inp}
                            placeholder={ph}
                            value={(profileForm[key as keyof Candidate] as string) || ""}
                            onChange={e => setProfileForm(p => ({ ...p, [key]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: Skills, Notes, AI Prompt */}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ ...card, padding: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Skills</h3>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <input
                        style={{ ...inp, flex: 1 }}
                        placeholder="Add skill (press Enter)"
                        value={skillInput}
                        onChange={e => setSkillInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                      />
                      <button onClick={addSkill} style={{ padding: "9px 14px", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        Add
                      </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {skills.length === 0 && <span style={{ fontSize: 12, color: "#64748b" }}>No skills added</span>}
                      {skills.map(s => (
                        <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                          {s}
                          <button onClick={() => setProfileForm(p => ({ ...p, skills: skills.filter(x => x !== s) }))} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ ...card, padding: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Notes</h3>
                    <textarea
                      rows={3}
                      style={{ ...inp, resize: "vertical" }}
                      placeholder="Recruiter notes about this candidate..."
                      value={(profileForm.notes as string) || ""}
                      onChange={e => setProfileForm(p => ({ ...p, notes: e.target.value }))}
                    />
                  </div>

                  {profileMsg && (
                    <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: profileMsg.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: profileMsg.ok ? "#34d399" : "#f87171", border: `1px solid ${profileMsg.ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                      {profileMsg.text}
                    </div>
                  )}
                  <button onClick={saveProfile} disabled={savingProfile} style={{ padding: "11px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: savingProfile ? "not-allowed" : "pointer", opacity: savingProfile ? 0.65 : 1 }}>
                    {savingProfile ? "Saving..." : "Save Profile"}
                  </button>

                  {/* AI Prompt */}
                  <div style={{ ...card, padding: 20, borderColor: "rgba(139,92,246,0.25)", background: "rgba(139,92,246,0.06)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <h3 style={{ fontSize: 13, fontWeight: 700, color: "#c4b5fd", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>AI Interview Prompt</h3>
                      {selected.generatedPrompt && (
                        <span style={{ fontSize: 10, color: "#34d399", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.25)", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>Saved</span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px", lineHeight: 1.5 }}>
                      {selected.resumeFileName ? `Resume: ${selected.resumeFileName}. ` : ""}
                      Generate a tailored interview prompt from candidate profile.
                    </p>
                    <button onClick={generatePrompt} disabled={generatingPrompt} style={{ padding: "8px 16px", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: generatingPrompt ? "not-allowed" : "pointer", opacity: generatingPrompt ? 0.65 : 1, marginBottom: generatedPrompt ? 10 : 0 }}>
                      {generatingPrompt ? "Generating…" : selected.generatedPrompt ? "Regenerate" : "Generate Prompt"}
                    </button>
                    {generatedPrompt && (
                      <>
                        <textarea readOnly rows={5} value={generatedPrompt} style={{ ...inp, marginTop: 10, fontSize: 12, resize: "vertical", lineHeight: 1.5 }} />
                        <button
                          onClick={() => { sessionStorage.setItem("pendingPrompt", generatedPrompt); window.location.href = "/recruiter/schedule"; }}
                          style={{ marginTop: 8, padding: "7px 14px", background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                        >
                          Use in Schedule →
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Timeline Tab ── */}
            {!loadingDetail && activeTab === "timeline" && (
              <div style={{ ...card, padding: 24 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 20px" }}>Interview Timeline</h2>
                {events.length === 0 ? (
                  <p style={{ color: "#64748b", textAlign: "center", padding: "30px 0" }}>No events recorded yet.</p>
                ) : (
                  <div style={{ position: "relative", paddingLeft: 30 }}>
                    <div style={{ position: "absolute", left: 9, top: 4, bottom: 4, width: 2, background: "rgba(139,92,246,0.2)" }} />
                    {events.map((ev, idx) => {
                      const def = EVENT_LABELS[ev.eventType] || { icon: "•", label: ev.eventType, color: "#64748b" };
                      const dt = new Date(ev.timestamp);
                      return (
                        <div key={ev._id} style={{ position: "relative", marginBottom: idx === events.length - 1 ? 0 : 20 }}>
                          <div style={{
                            position: "absolute", left: -30, top: 2, width: 20, height: 20, borderRadius: "50%",
                            background: `rgba(${def.color === "#a78bfa" ? "167,139,250" : "99,102,241"},0.2)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, border: `1.5px solid ${def.color}40`,
                          }}>
                            <span>{def.icon}</span>
                          </div>
                          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: def.color }}>{def.label}</span>
                              <span style={{ fontSize: 10, color: "#64748b" }}>
                                {dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            {ev.metadata && Object.entries(ev.metadata).some(([, v]) => v) && (
                              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {!!ev.metadata.overallScore && <span style={{ fontSize: 10, background: "rgba(16,185,129,0.12)", color: "#34d399", padding: "1px 7px", borderRadius: 20, fontWeight: 700 }}>Score: {String(ev.metadata.overallScore)}/10</span>}
                                {!!ev.metadata.recommendation && <span style={{ fontSize: 10, background: "rgba(139,92,246,0.12)", color: "#a78bfa", padding: "1px 7px", borderRadius: 20, fontWeight: 700 }}>{String(ev.metadata.recommendation)}</span>}
                                {!!ev.metadata.attemptNumber && <span style={{ fontSize: 10, background: "rgba(96,165,250,0.12)", color: "#93c5fd", padding: "1px 7px", borderRadius: 20, fontWeight: 700 }}>Attempt {String(ev.metadata.attemptNumber)}</span>}
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

            {/* ── Interviews Tab ── */}
            {!loadingDetail && activeTab === "interviews" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {meetings.length === 0 ? (
                  <div style={{ ...card, padding: 40, textAlign: "center" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                    <p style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600, margin: "0 0 6px" }}>No interviews yet</p>
                    <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 16px" }}>Schedule an AI interview to see results here</p>
                    <Link href={`/recruiter/schedule?candidateId=${selected._id}`} style={{
                      background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff",
                      padding: "9px 20px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 700,
                    }}>Schedule Interview →</Link>
                  </div>
                ) : meetings.map((m, i) => {
                  const score = m.scorecard?.overall_score;
                  const rec = m.scorecard?.recommendation;
                  return (
                    <div key={i} style={{ ...card, padding: 20 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
                              Attempt #{m.attemptNumber || i + 1}
                            </span>
                            {score && <ScoreChip score={score} />}
                            {rec && <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{rec}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                            {m.roleName || "Interview"}
                            {m.interviewStatus && ` · ${m.interviewStatus.replace(/_/g, " ")}`}
                          </div>
                        </div>
                        {score && (
                          <button
                            onClick={() => setModal([m])}
                            style={{ padding: "6px 14px", background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                          >
                            View Scorecard
                          </button>
                        )}
                      </div>
                      {m.recordingUrl && (
                        <div style={{ marginTop: 10 }}>
                          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Recording</p>
                          <audio controls src={m.recordingUrl} style={{ width: "100%", height: 36 }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}
      </div>

      {modal && <ScorecardDetailModal meetings={modal} onClose={() => setModal(null)} dashboardUrl="/recruiter/candidates" />}
    </div>
  );
}
