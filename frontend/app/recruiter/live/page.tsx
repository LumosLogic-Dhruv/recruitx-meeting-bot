"use client";
import { useState, useEffect, useRef } from "react";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";
function auth() { return `Bearer ${localStorage.getItem("token")}`; }

interface TranscriptEntry { speaker: string; text: string; }
interface ActiveSession {
  bot_id: string;
  meeting_url: string;
  candidate_name: string;
  bot_name: string;
  bot_status: "joining" | "in_waiting_room" | "in_call" | "done";
  recruiter_id: string;
  candidate_id: string;
  role_name: string;
  transcript: TranscriptEntry[];
  elapsed_seconds: number;
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function statusBadge(status: string) {
  switch (status) {
    case "in_waiting_room": return { label: "Waiting Room", color: "#dc2626", bg: "#fef2f2" };
    case "in_call":         return { label: "● Live", color: "#16a34a", bg: "#f0fdf4" };
    case "joining":         return { label: "Connecting...", color: "#d97706", bg: "#fff7ed" };
    default:                return { label: status, color: "#64748b", bg: "#f1f5f9" };
  }
}

export default function LiveInterviewPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const transcriptRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "/login"; return; }

    function fetchSessions() {
      fetch(`${BASE}/api/active-sessions`, { headers: { Authorization: auth() } })
        .then(r => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json();
        })
        .then(d => {
          setSessions(d.sessions || []);
          setLastUpdated(new Date());
          setError("");
        })
        .catch(e => setError(e.message));
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll transcript to bottom when new turns arrive
  useEffect(() => {
    sessions.forEach(s => {
      const el = transcriptRefs.current[s.bot_id];
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [sessions]);

  const badge = (s: ActiveSession) => statusBadge(s.bot_status);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>Live Interviews</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            {sessions.length} active · auto-refreshes every 3s
            {lastUpdated && ` · ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{
            width: 9, height: 9, borderRadius: "50%",
            background: sessions.length > 0 ? "#16a34a" : "#94a3b8",
            boxShadow: sessions.length > 0 ? "0 0 0 3px #dcfce7" : "none",
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: sessions.length > 0 ? "#16a34a" : "#94a3b8" }}>
            {sessions.length > 0 ? "Active" : "No active sessions"}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>
          Could not reach backend: {error}
        </div>
      )}

      {sessions.length === 0 && !error ? (
        <div style={{ background: "#fff", border: "1px dashed #e2e8f0", borderRadius: 16, padding: 60, textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🎙️</div>
          <p style={{ color: "#374151", fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>No interviews in progress</p>
          <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>This page auto-refreshes every 3 seconds when an interview begins</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {sessions.map(session => {
            const st = badge(session);
            const isBot = (speaker: string) => speaker === "AI" || speaker.toLowerCase().includes("recruit");
            return (
              <div key={session.bot_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>

                {/* Session header */}
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{session.candidate_name}</h3>
                      <span style={{ background: st.bg, color: st.color, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                        {st.label}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                      {session.role_name || "Interview"} · Bot: {session.bot_name} · {formatElapsed(session.elapsed_seconds)}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "#94a3b8" }}>
                    {session.transcript.length} turn{session.transcript.length !== 1 ? "s" : ""}
                  </div>
                </div>

                {/* Waiting room warning */}
                {session.bot_status === "in_waiting_room" && (
                  <div style={{ padding: "14px 20px", background: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                      <div>
                        <div style={{ fontWeight: 700, color: "#dc2626", fontSize: 14, marginBottom: 4 }}>
                          Bot is stuck in Google Meet Waiting Room
                        </div>
                        <div style={{ color: "#991b1b", fontSize: 13, lineHeight: 1.5 }}>
                          Open the Google Meet link and admit <strong>&quot;{session.bot_name}&quot;</strong> from the waiting room.
                          Only the meeting host can do this — the candidate cannot admit the bot.
                        </div>
                        <a
                          href={session.meeting_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-block", marginTop: 10, background: "#dc2626", color: "#fff", padding: "7px 16px", borderRadius: 7, fontSize: 13, fontWeight: 700, textDecoration: "none" }}
                        >
                          Open Google Meet to Admit Bot →
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {/* Joining banner */}
                {session.bot_status === "joining" && (
                  <div style={{ padding: "10px 20px", background: "#fff7ed", borderBottom: "1px solid #fed7aa", fontSize: 13, color: "#92400e" }}>
                    🔄 Bot is connecting to the meeting...
                  </div>
                )}

                {/* Live transcript */}
                <div
                  ref={el => { transcriptRefs.current[session.bot_id] = el; }}
                  style={{ padding: "16px 20px", maxHeight: 420, overflowY: "auto", background: "#fafafa" }}
                >
                  {session.transcript.length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "24px 0", margin: 0 }}>
                      {session.bot_status === "in_call"
                        ? "Waiting for conversation to begin..."
                        : "Transcript will appear here once the bot joins the call"}
                    </p>
                  ) : (
                    session.transcript.map((turn, i) => {
                      const bot = isBot(turn.speaker);
                      return (
                        <div key={i} style={{ marginBottom: 14, display: "flex", flexDirection: "column", alignItems: bot ? "flex-end" : "flex-start" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: bot ? "#7c3aed" : "#2563eb", marginBottom: 3 }}>
                            {bot ? "AI Bot" : turn.speaker}
                          </span>
                          <div style={{
                            maxWidth: "78%", padding: "9px 13px", fontSize: 13, lineHeight: 1.6,
                            borderRadius: bot ? "13px 13px 4px 13px" : "13px 13px 13px 4px",
                            background: bot ? "#ede9fe" : "#eff6ff",
                            color: bot ? "#4c1d95" : "#1e3a8a",
                          }}>
                            {turn.text}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Legend */}
                <div style={{ padding: "8px 20px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 16, fontSize: 11, color: "#94a3b8" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: "#ede9fe", display: "inline-block" }} />
                    AI Bot (right)
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: "#eff6ff", display: "inline-block" }} />
                    Candidate (left)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
