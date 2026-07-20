"use client";
import { useState, useEffect, useRef } from "react";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";
const G = "rgba(255,255,255,";
function auth() { return `Bearer ${localStorage.getItem("token")}`; }

interface TranscriptEntry { speaker: string; text: string; }
interface ActiveSession {
  bot_id: string; meeting_url: string; candidate_name: string; bot_name: string;
  bot_status: "joining" | "in_waiting_room" | "in_call" | "done";
  recruiter_id: string; candidate_id: string; role_name: string;
  transcript: TranscriptEntry[]; elapsed_seconds: number;
}

function formatElapsed(s: number) { return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`; }

function statusBadge(status: string) {
  switch (status) {
    case "in_waiting_room": return { label: "Waiting Room", color: "#f87171", bg: "rgba(239,68,68,0.15)" };
    case "in_call":         return { label: "● Live",       color: "#34d399", bg: "rgba(16,185,129,0.15)" };
    case "joining":         return { label: "Connecting…",  color: "#fbbf24", bg: "rgba(245,158,11,0.15)" };
    default:                return { label: status,         color: "#94a3b8", bg: `${G}0.06)` };
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
        .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
        .then(d => { setSessions(d.sessions || []); setLastUpdated(new Date()); setError(""); })
        .catch(e => setError(e.message));
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    sessions.forEach(s => {
      const el = transcriptRefs.current[s.bot_id];
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [sessions]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: "0 0 4px" }}>Live Interviews</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            {sessions.length} active · auto-refreshes every 3s
            {lastUpdated && ` · ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: sessions.length > 0 ? "#34d399" : "#475569", boxShadow: sessions.length > 0 ? "0 0 0 3px rgba(52,211,153,0.2)" : "none" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: sessions.length > 0 ? "#34d399" : "#64748b" }}>
            {sessions.length > 0 ? "Active" : "No active sessions"}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171", marginBottom: 16 }}>
          Could not reach backend: {error}
        </div>
      )}

      {sessions.length === 0 && !error ? (
        <div style={{ background: `${G}0.04)`, backdropFilter: "blur(20px)", border: `1px dashed ${G}0.10)`, borderRadius: 16, padding: 60, textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🎙️</div>
          <p style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>No interviews in progress</p>
          <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>This page auto-refreshes every 3 seconds when an interview begins</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {sessions.map(session => {
            const st = statusBadge(session.bot_status);
            const isBot = (speaker: string) => speaker === "AI" || speaker.toLowerCase().includes("recruit");
            return (
              <div key={session.bot_id} style={{ background: `${G}0.05)`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: `1px solid ${G}0.09)`, borderRadius: 14, overflow: "hidden" }}>

                {/* Session header */}
                <div style={{ padding: "16px 20px", borderBottom: `1px solid ${G}0.08)`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>{session.candidate_name}</h3>
                      <span style={{ background: st.bg, color: st.color, padding: "3px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                      {session.role_name || "Interview"} · Bot: {session.bot_name} · {formatElapsed(session.elapsed_seconds)}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "#64748b" }}>
                    {session.transcript.length} turn{session.transcript.length !== 1 ? "s" : ""}
                  </div>
                </div>

                {/* Waiting room warning */}
                {session.bot_status === "in_waiting_room" && (
                  <div style={{ padding: "14px 20px", background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                      <div>
                        <div style={{ fontWeight: 700, color: "#f87171", fontSize: 14, marginBottom: 4 }}>Bot is stuck in Google Meet Waiting Room</div>
                        <div style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.5 }}>
                          Open the Meet link and admit <strong>&quot;{session.bot_name}&quot;</strong> from the waiting room.
                        </div>
                        <a href={session.meeting_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 10, background: "rgba(239,68,68,0.2)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)", padding: "7px 16px", borderRadius: 7, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                          Open Google Meet to Admit Bot →
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {session.bot_status === "joining" && (
                  <div style={{ padding: "10px 20px", background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.15)", fontSize: 12, color: "#fbbf24" }}>
                    🔄 Bot is connecting to the meeting...
                  </div>
                )}

                {/* Live transcript */}
                <div ref={el => { transcriptRefs.current[session.bot_id] = el; }} style={{ padding: "16px 20px", maxHeight: 420, overflowY: "auto", background: `${G}0.02)` }}>
                  {session.transcript.length === 0 ? (
                    <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: "24px 0", margin: 0 }}>
                      {session.bot_status === "in_call" ? "Waiting for conversation to begin..." : "Transcript will appear here once the bot joins"}
                    </p>
                  ) : (
                    session.transcript.map((turn, i) => {
                      const bot = isBot(turn.speaker);
                      return (
                        <div key={i} style={{ marginBottom: 14, display: "flex", flexDirection: "column", alignItems: bot ? "flex-end" : "flex-start" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: bot ? "#a78bfa" : "#60a5fa", marginBottom: 3 }}>
                            {bot ? "AI Bot" : turn.speaker}
                          </span>
                          <div style={{
                            maxWidth: "78%", padding: "9px 13px", fontSize: 13, lineHeight: 1.6,
                            borderRadius: bot ? "13px 13px 4px 13px" : "13px 13px 13px 4px",
                            background: bot ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.12)",
                            color: bot ? "#c4b5fd" : "#93c5fd",
                            border: `1px solid ${bot ? "rgba(139,92,246,0.2)" : "rgba(59,130,246,0.15)"}`,
                          }}>
                            {turn.text}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Legend */}
                <div style={{ padding: "8px 20px", borderTop: `1px solid ${G}0.07)`, display: "flex", gap: 16, fontSize: 11, color: "#64748b" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(139,92,246,0.15)", display: "inline-block" }} />AI Bot (right)
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(59,130,246,0.12)", display: "inline-block" }} />Candidate (left)
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
