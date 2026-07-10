"use client";
import { useState, useEffect } from "react";
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
  _id: string; name: string; email: string; roleName?: string;
  interviewStatus?: string; resumeFileName?: string; attemptCount?: number;
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

export default function CandidateTimelinePage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api(`/api/candidates`).then(r => r.json()).then(d => {
        const c = (d.candidates || []).find((c: Candidate) => c._id === id);
        setCandidate(c || null);
      }),
      api(`/api/candidates/${id}/timeline`).then(r => r.json()).then(d => {
        setEvents(d.timeline || []);
      }),
    ]).finally(() => setLoading(false));
  }, [id]);

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true); setUploadMsg("Uploading...");
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
      setEvents(prev => [...prev, {
        _id: Date.now().toString(),
        eventType: "resume_uploaded",
        timestamp: Date.now(),
        actor: "recruiter",
        metadata: { fileName: d.fileName, charCount: d.charCount },
      }]);
    } catch (err: unknown) {
      setUploadMsg(err instanceof Error ? err.message : "Error");
    } finally { setUploading(false); }
  }

  if (loading) return <div style={{ padding: 40, color: "#64748b" }}>Loading...</div>;
  if (!candidate) return <div style={{ padding: 40, color: "#dc2626" }}>Candidate not found.</div>;

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div>
          <Link href="/recruiter/add" style={{ fontSize: 13, color: "#7c3aed", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            ← Back to Candidates
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>{candidate.name}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#64748b" }}>
            {candidate.email} {candidate.roleName ? `· ${candidate.roleName}` : ""} {candidate.attemptCount ? `· Attempt ${candidate.attemptCount}/2` : ""}
          </p>
        </div>
        {/* Resume upload */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", minWidth: 260 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>📄 Resume / CV</div>
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

      {/* Timeline */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 24px" }}>Interview Timeline</h2>

        {events.length === 0 ? (
          <p style={{ color: "#64748b", textAlign: "center", padding: 40 }}>No events recorded yet.</p>
        ) : (
          <div style={{ position: "relative", paddingLeft: 32 }}>
            {/* Vertical line */}
            <div style={{ position: "absolute", left: 11, top: 0, bottom: 0, width: 2, background: "#e2e8f0" }} />

            {events.map((ev, idx) => {
              const def = EVENT_LABELS[ev.eventType] || { icon: "•", label: ev.eventType, color: "#64748b" };
              const isLast = idx === events.length - 1;
              const dt = new Date(ev.timestamp);
              return (
                <div key={ev._id} style={{ position: "relative", marginBottom: isLast ? 0 : 28 }}>
                  {/* Dot */}
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
    </>
  );
}
