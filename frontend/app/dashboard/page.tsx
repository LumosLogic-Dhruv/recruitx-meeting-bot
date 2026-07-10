"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { logout, getUser, checkSession } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

type Tab = "interview" | "history" | "schedule" | "prompts";

interface TranscriptEntry { speaker: string; text: string; }
interface Scorecard {
  overall_score?: number; recommendation?: string; summary?: string;
  dimensions?: { name: string; score: number; comment?: string }[];
  green_flags?: string[]; red_flags?: string[];
  skill_breakdown?: { name: string; score: number; description?: string }[];
  areas_for_improvement?: string[];
  top_strengths?: (string | { name: string; score?: number })[];
  top_gaps?: (string | { name: string; score?: number })[];
  candidate_name?: string;
}
interface Meeting { _id: string; botId?: string; meetingUrl?: string; candidateName?: string; roleName?: string; createdAt?: number; transcript?: TranscriptEntry[]; scorecard?: Scorecard; recordingUrl?: string; botAudioUrl?: string; candidateAudioUrl?: string; }
interface Prompt { _id: string; roleName: string; promptText: string; }
interface Candidate { _id: string; name: string; email: string; interviewStatus?: string; cooldownUntil?: number; }
interface ScheduledInterview { _id: string; candidateName: string; roleName: string; scheduledAt: number; attemptNumber?: number; status: string; }

function auth() { return `Bearer ${localStorage.getItem("token")}` }

function ScorecardView({ sc }: { sc: Scorecard }) {
  if (!sc?.overall_score) return null;
  const col = sc.overall_score >= 7 ? "#10b981" : sc.overall_score >= 5 ? "#8b5cf6" : "#f59e0b";
  const recColor = (sc.recommendation || "").includes("STRONG") ? "#10b981" : (sc.recommendation || "").includes("NO") ? "#ef4444" : "#f59e0b";
  const skills = sc.skill_breakdown?.length ? sc.skill_breakdown : sc.dimensions?.map(d => ({ name: d.name, score: d.score, description: d.comment || "" })) || [];
  return (
    <div style={{ fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
          <svg width="80" height="80" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="40" cy="40" r="32" fill="none" stroke="#e2e8f0" strokeWidth="8" />
            <circle cx="40" cy="40" r="32" fill="none" stroke="#8b5cf6" strokeWidth="8" strokeDasharray={`${Math.round((sc.overall_score / 10) * 201)} 201`} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{sc.overall_score}</span>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>/10</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {sc.recommendation && <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${recColor}22`, color: recColor, border: `1px solid ${recColor}`, marginBottom: 8 }}>{sc.recommendation}</span>}
          {sc.summary && <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, margin: 0 }}>{sc.summary}</p>}
        </div>
      </div>
      {skills.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b", marginBottom: 10 }}>Skill Breakdown</div>
          {skills.map((sk, i) => {
            const bc = sk.score >= 7 ? "#10b981" : sk.score >= 5 ? "#8b5cf6" : "#f59e0b";
            return (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{sk.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: bc }}>{sk.score}</span>
                </div>
                <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, marginBottom: 6 }}>
                  <div style={{ height: 6, background: bc, borderRadius: 3, width: `${(sk.score / 10) * 100}%` }} />
                </div>
                {(sk as {description?: string}).description && <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.55, margin: 0 }}>{(sk as {description?: string}).description}</p>}
              </div>
            );
          })}
        </div>
      )}
      {sc.areas_for_improvement && sc.areas_for_improvement.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Areas for Improvement</div>
          {sc.areas_for_improvement.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 13, color: "#92400e" }}>
              <span style={{ fontWeight: 700, color: "#d97706", flexShrink: 0 }}>{i + 1}.</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
      {(sc.green_flags?.length || sc.red_flags?.length) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {sc.green_flags && sc.green_flags.length > 0 && (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Green Flags</div>
              {sc.green_flags.map((f, i) => <div key={i} style={{ fontSize: 12, color: "#166534", marginBottom: 6, lineHeight: 1.5 }}><span style={{ color: "#16a34a", fontWeight: 700 }}>+</span> {f}</div>)}
            </div>
          )}
          {sc.red_flags && sc.red_flags.length > 0 && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Red Flags</div>
              {sc.red_flags.map((f, i) => <div key={i} style={{ fontSize: 12, color: "#991b1b", marginBottom: 6, lineHeight: 1.5 }}><span style={{ color: "#dc2626", fontWeight: 700 }}>-</span> {f}</div>)}
            </div>
          )}
        </div>
      )}
      <p style={{ color: col, fontSize: 12, margin: "12px 0 0", fontWeight: 600, textAlign: "center" }}>Overall: {sc.overall_score}/10</p>
    </div>
  );
}

// ─── TAB: INTERVIEW ROOM ───────────────────────────────────────────────────
function InterviewRoom() {
  const DEFAULT_PROMPT = `You are Alex, a friendly AI interviewer conducting a Google Meet interview.

CONVERSATION STYLE:
- Sound human — use natural filler: "Got it.", "Interesting.", "Right, so...", "That makes sense."
- React genuinely to what the candidate actually says — never invent facts about them.
- Use contractions always. Keep responses to 1-2 sentences max.
- ONE question per turn. Never ask two questions at once.
- If the candidate's answer is vague or short, ask them to elaborate before moving on.
- Mirror the candidate's energy — warm but professional.

INTERVIEW FLOW:
1. Warm intro — ask them to introduce themselves and share their background.
2. Dig into their experience based on what THEY tell you.
3. Ask about 3-4 role-relevant technical areas (adapt based on their background).
4. One soft-skills question (how they handle challenges, collaboration, etc.).
5. Wrap up — thank them, explain next steps.

HARD RULES:
- Never repeat a question already answered.
- Never ask multiple questions in one response.
- Only reference what the candidate has explicitly said in this conversation.
- Keep the total interview under 10 minutes.`;

  const [meetUrl, setMeetUrl] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [candidateName, setCandidateName] = useState("");
  const [voice, setVoice] = useState("custom");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [status, setStatus] = useState<{ msg: string; type: string } | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [live, setLive] = useState(false);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [activeMeetUrl, setActiveMeetUrl] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const lastLenRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${BASE}/api/prompts`, { headers: { Authorization: auth() } })
      .then(r => r.json()).then(d => setPrompts(d.prompts || [])).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [transcript]);

  const poll = useCallback(async () => {
    if (!activeBotId) return;
    try {
      const res = await fetch(`${BASE}/transcript/${activeBotId}`, { headers: { Authorization: auth() } });
      if (!res.ok) return;
      const data = await res.json();
      const t: TranscriptEntry[] = data.transcript || [];
      if (t.length > lastLenRef.current) { lastLenRef.current = t.length; setTranscript([...t]); }
    } catch { /* ignore */ }
  }, [activeBotId]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (activeBotId) {
      pollRef.current = setInterval(poll, 3000);
      poll();
    }
  }, [activeBotId, poll]);

  async function startInterview() {
    const raw = meetUrl.trim();
    if (!raw) { setStatus({ msg: "Please enter a Google Meet URL.", type: "error" }); return; }
    const url = raw.startsWith("http") ? raw : `https://meet.google.com/${raw}`;
    setLoading(true); setScorecard(null); setTranscript([]);
    setStatus({ msg: "Sending bot into the meeting… (may take 1-2 min to join)", type: "info" });
    try {
      const res = await fetch(`${BASE}/start-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth() },
        body: JSON.stringify({ meeting_url: url, system_prompt: prompt, bot_name: "RecruitX AI", voice_id: voice, candidate_name: candidateName || "Candidate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
      setActiveMeetUrl(url); setActiveBotId(data.bot_id); lastLenRef.current = 0;
      setLive(true); setLoading(false);
      setStatus({ msg: "Bot is joining the meeting. It will greet the candidate once it is in (1-2 min).", type: "success" });
    } catch (err: unknown) { setStatus({ msg: "Error: " + (err instanceof Error ? err.message : "Unknown"), type: "error" }); setLoading(false); }
  }

  async function endInterview() {
    if (!activeMeetUrl) return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setLoading(true);
    setStatus({ msg: "Ending interview and generating evaluation scorecard…", type: "info" });
    try {
      const res = await fetch(`${BASE}/end-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth() },
        body: JSON.stringify({ meeting_url: activeMeetUrl, candidate_name: candidateName || "Candidate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
      if (data.transcript?.length) setTranscript(data.transcript);
      setLive(false); setActiveMeetUrl(null); setActiveBotId(null);
      setLoading(false);
      setStatus({ msg: "Interview complete. Transcript and Evaluation stored in database.", type: "success" });
      if (data.scorecard) setScorecard(data.scorecard);
    } catch (err: unknown) { setStatus({ msg: "Error: " + (err instanceof Error ? err.message : "Unknown"), type: "error" }); setLoading(false); }
  }

  const btnStyle = (primary: boolean, danger = false): React.CSSProperties => ({
    flex: 1, padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: "pointer",
    background: danger ? "rgba(239,68,68,0.1)" : primary ? "linear-gradient(135deg,#8b5cf6,#7c3aed)" : "#f1f5f9",
    color: danger ? "#ef4444" : primary ? "#fff" : "#374151",
    border: danger ? "1px solid rgba(239,68,68,0.3)" : "none",
  });
  const inp: React.CSSProperties = { width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0f172a", fontSize: 14, padding: "12px 14px", outline: "none", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      {/* Setup */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <div><h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Setup Interview</h3><p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>Deploy a bot into a Google Meet call.</p></div>

        <div><label style={lbl}>Google Meet Link</label><input style={inp} placeholder="https://meet.google.com/abc-defg-hij" value={meetUrl} onChange={e => setMeetUrl(e.target.value)} /></div>

        <div>
          <label style={lbl}>Select Role &amp; System Prompt</label>
          <select style={inp} onChange={e => { if (e.target.value) setPrompt(e.target.value); }}>
            <option value="">-- Custom / Generate New --</option>
            {prompts.map(p => <option key={p._id} value={p.promptText}>{p.roleName}</option>)}
          </select>
        </div>

        <div><label style={lbl}>System Prompt</label><textarea style={{ ...inp, minHeight: 180, resize: "vertical" }} value={prompt} onChange={e => setPrompt(e.target.value)} /></div>

        <div><label style={lbl}>Candidate Name</label><input style={inp} placeholder="Jane Doe" value={candidateName} onChange={e => setCandidateName(e.target.value)} /></div>

        <div>
          <label style={lbl}>Interviewer Voice</label>
          <div style={{ display: "flex", gap: 10 }}>
            {[{ v: "custom", title: "Indian HR Interviewer", sub: "Confident, professional tone" }, { v: "nila", title: "Nila", sub: "Professional Guide, Indian accent" }].map(o => (
              <label key={o.v} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 14px", border: `2px solid ${voice === o.v ? "#8b5cf6" : "#e2e8f0"}`, borderRadius: 10, flex: 1, background: voice === o.v ? "rgba(139,92,246,0.08)" : "#fff", transition: "all .15s" }}>
                <input type="radio" name="voice" value={o.v} checked={voice === o.v} onChange={() => setVoice(o.v)} style={{ accentColor: "#8b5cf6", width: 16, height: 16, flexShrink: 0 }} />
                <div><div style={{ fontWeight: 600, fontSize: 13 }}>{o.title}</div><div style={{ fontSize: 11, color: "#64748b" }}>{o.sub}</div></div>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <button style={btnStyle(true)} disabled={loading || !!activeMeetUrl} onClick={startInterview}>Start Interview</button>
          <button style={btnStyle(false, true)} disabled={!activeMeetUrl || loading} onClick={endInterview}>End Interview</button>
        </div>

        {status && (
          <div style={{ padding: "12px 16px", borderRadius: 10, fontSize: 13, background: status.type === "success" ? "rgba(16,185,129,0.1)" : status.type === "error" ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)", border: `1px solid ${status.type === "success" ? "#10b981" : status.type === "error" ? "#ef4444" : "#8b5cf6"}`, color: status.type === "success" ? "#065f46" : status.type === "error" ? "#991b1b" : "#6b21a8" }}>
            {status.msg}
          </div>
        )}

        {scorecard && <div style={{ marginTop: 8 }}><ScorecardView sc={scorecard} /></div>}
      </div>

      {/* Live feed */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 500 }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 16, fontWeight: 700 }}>Live Conversation</div><div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{live ? `Active: ${activeMeetUrl?.split("/").pop()}` : "Waiting for interview to start…"}</div></div>
          {live && <span style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />LIVE</span>}
        </div>
        <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 12 }}>
          {transcript.length === 0 ? (
            <div style={{ textAlign: "center", color: "#64748b", padding: "40px 20px", fontSize: 14 }}>No active session. The real-time transcript will appear here.</div>
          ) : transcript.map((t, i) => {
            const isBot = !t.speaker || t.speaker === "bot" || t.speaker.toLowerCase().includes("recruitx") || t.speaker.toLowerCase().includes("alex");
            return (
              <div key={i} style={{ display: "flex", flexDirection: isBot ? "row" : "row-reverse", gap: 12, alignItems: "flex-end" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: isBot ? "#8b5cf6" : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{isBot ? "🤖" : "👤"}</div>
                <div style={{ maxWidth: "75%", background: isBot ? "linear-gradient(135deg,#8b5cf6,#7c3aed)" : "#f1f5f9", color: isBot ? "#fff" : "#0f172a", padding: "10px 14px", borderRadius: isBot ? "12px 12px 12px 4px" : "12px 12px 4px 12px", fontSize: 14, lineHeight: 1.5 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.75, marginBottom: 4 }}>{t.speaker}</div>
                  {t.text}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── TAB: PAST TRANSCRIPTS ────────────────────────────────────────────────
function PastTranscripts() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [modal, setModal] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/meetings`, { headers: { Authorization: auth() } })
      .then(r => r.json()).then(d => { setMeetings(d.meetings || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Past Transcripts</h3>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>Historical records of all completed meetings, transcripts, and evaluation scorecards.</p>
      </div>
      {loading ? <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading transcripts…</div> :
        meetings.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>No past meetings found.</div> :
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px,1fr))", gap: 16 }}>
          {meetings.map(m => {
            const sc = m.scorecard;
            const col = sc?.overall_score ? (sc.overall_score >= 7 ? "#10b981" : sc.overall_score >= 5 ? "#f59e0b" : "#ef4444") : "#64748b";
            return (
              <div key={m._id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 24, cursor: "pointer", transition: "box-shadow .2s" }} onClick={() => setModal(m)}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{m.candidateName || "Unknown"}</div>
                  {sc?.overall_score && <span style={{ background: col, color: "#fff", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700 }}>{sc.overall_score}/10</span>}
                </div>
                {m.roleName && <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>{m.roleName}</div>}
                {sc?.recommendation && <div style={{ fontSize: 12, color: "#8b5cf6", fontWeight: 600 }}>{sc.recommendation}</div>}
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>{m.transcript?.length || 0} messages · {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}</div>
              </div>
            );
          })}
        </div>
      }

      {modal && (
        <div onClick={e => { if (e.target === e.currentTarget) setModal(null); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, backdropFilter: "blur(4px)" }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 24, width: "100%", maxWidth: 1100, height: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 60px rgba(0,0,0,.15)" }}>
            <div style={{ padding: "24px 32px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div><h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{modal.candidateName}</h3><p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>{modal.roleName} · {modal.createdAt ? new Date(modal.createdAt).toLocaleString() : "—"}</p></div>
              <button onClick={() => setModal(null)} style={{ background: "transparent", border: "none", fontSize: 24, color: "#64748b", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: "1.2fr 1fr" }}>
              <div style={{ borderRight: "1px solid #e2e8f0", padding: 32, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
                {(modal.transcript || []).length === 0 ? <p style={{ color: "#64748b" }}>No transcript available.</p> :
                  (modal.transcript || []).map((t, i) => {
                    const isBot = !t.speaker || t.speaker === "bot" || t.speaker.toLowerCase().includes("recruitx") || t.speaker.toLowerCase().includes("alex");
                    return (
                      <div key={i} style={{ display: "flex", flexDirection: isBot ? "row" : "row-reverse", gap: 10, alignItems: "flex-end" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: isBot ? "#8b5cf6" : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{isBot ? "🤖" : "👤"}</div>
                        <div style={{ maxWidth: "75%", background: isBot ? "linear-gradient(135deg,#8b5cf6,#7c3aed)" : "#f1f5f9", color: isBot ? "#fff" : "#0f172a", padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.5 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, opacity: .75, marginBottom: 3 }}>{t.speaker}</div>
                          {t.text}
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div style={{ padding: 32, overflowY: "auto" }}>
                {modal.scorecard ? <ScorecardView sc={modal.scorecard} /> : <p style={{ color: "#64748b" }}>No scorecard available.</p>}
                {modal.recordingUrl && <div style={{ marginTop: 16, textAlign: "center" }}><a href={modal.recordingUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "#7c3aed", color: "#fff", padding: "9px 20px", borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: "none" }}>▶ Watch Recording</a></div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB: SCHEDULE INTERVIEW ──────────────────────────────────────────────
function ScheduleTab() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledInterview[]>([]);
  const [form, setForm] = useState({ candidateId: "", datetime: "", duration: "30", role: "", promptText: "" });
  const [alert, setAlert] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [smtp, setSmtp] = useState({ host: "smtp.gmail.com", port: "587", user: "", pass: "" });
  const [smtpStatus, setSmtpStatus] = useState("Checking...");
  const [smtpAlert, setSmtpAlert] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/candidates`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setCandidates((d.candidates || []).filter((c: Candidate) => !c.interviewStatus || c.interviewStatus === "never_invited"))),
      fetch(`${BASE}/api/prompts`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setPrompts(d.prompts || [])),
      fetch(`${BASE}/api/interviews/scheduled`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setScheduled(d.interviews || [])).catch(() => {}),
      fetch(`${BASE}/api/auth/google/status`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setGoogleConnected(d.connected)).catch(() => {}),
      fetch(`${BASE}/api/settings/smtp`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => {
        if (d.smtp_host) setSmtp({ host: d.smtp_host, port: String(d.smtp_port || 587), user: d.smtp_user || "", pass: "" });
        setSmtpStatus(d.configured ? "Configured ✓" : "Not configured");
      }).catch(() => { setSmtpStatus("Unknown"); }),
    ]);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setAlert({ msg: "Creating Google Meet and sending invite...", type: "info" });
    try {
      const res = await fetch(`${BASE}/api/interviews/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth() },
        body: JSON.stringify({ candidate_id: form.candidateId, scheduled_at_iso: new Date(form.datetime).toISOString(), duration_minutes: parseInt(form.duration), role_name: form.role || "Interview", system_prompt: form.promptText, platform: "google_meet" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setAlert({ msg: `Scheduled! Email sent: ${d.email_sent ? "Yes ✓" : "No — check SMTP settings"}`, type: "success" });
      setForm({ candidateId: "", datetime: "", duration: "30", role: "", promptText: "" });
      fetch(`${BASE}/api/interviews/scheduled`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setScheduled(d.interviews || []));
    } catch (err: unknown) { setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" }); }
    finally { setLoading(false); }
  }

  async function saveSmtp() {
    try {
      const res = await fetch(`${BASE}/api/settings/smtp`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: auth() },
        body: JSON.stringify({ smtp_host: smtp.host, smtp_port: parseInt(smtp.port), smtp_user: smtp.user, smtp_pass: smtp.pass }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setSmtpAlert("SMTP settings saved ✓"); setSmtpStatus("Configured ✓");
    } catch (err: unknown) { setSmtpAlert(err instanceof Error ? err.message : "Error"); }
  }

  const inp: React.CSSProperties = { width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
  const statusBg: Record<string, string[]> = { pending: ["#eff6ff", "#1d4ed8"], active: ["#f0fdf4", "#16a34a"], completed: ["#f1f5f9", "#64748b"], cancelled: ["#fef2f2", "#dc2626"] };

  return (
    <div>
      <div style={{ marginBottom: 14, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div><h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Schedule Interview</h3><p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>Add candidates, generate meeting links, and send email invitations automatically.</p></div>
      </div>
      {!googleConnected && (
        <div style={{ padding: "12px 18px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: "#92400e", fontWeight: 500 }}>⚠ Google account not connected — required for creating Meet links and sending emails.</span>
          <button onClick={() => window.location.href = `${BASE}/api/auth/google`} style={{ padding: "9px 18px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Connect Google Account</button>
        </div>
      )}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div><h4 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 3px" }}>Email (SMTP) Settings</h4><p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Used to send interview invite emails to candidates.</p></div>
          <div style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: "#f1f5f9", color: "#64748b" }}>{smtpStatus}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[["SMTP Host", "smtp.gmail.com", "host"], ["Port", "587", "port"], ["Sender Email", "recruitx@gmail.com", "user"], ["App Password", "", "pass"]].map(([label, ph, key]) => (
            <div key={key}>
              <label style={{ ...lbl, fontSize: 12 }}>{label}</label>
              <input style={inp} placeholder={ph} type={key === "pass" ? "password" : "text"} value={(smtp as Record<string, string>)[key]} onChange={e => setSmtp(p => ({ ...p, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={saveSmtp} style={{ padding: "9px 22px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Save SMTP Settings</button>
          {smtpAlert && <span style={{ fontSize: 12, color: "#64748b" }}>{smtpAlert}</span>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Schedule form */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h4 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px" }}>Schedule Interview</h4>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label style={lbl}>Select Candidate</label><select style={inp} value={form.candidateId} onChange={e => setForm(p => ({ ...p, candidateId: e.target.value }))}><option value="">-- Select a candidate --</option>{candidates.map(c => <option key={c._id} value={c._id}>{c.name} ({c.email})</option>)}</select></div>
            <div><label style={lbl}>Role / Position</label><input style={inp} placeholder="e.g. Senior Frontend Engineer" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} /></div>
            <div><label style={lbl}>Select System Prompt</label><select style={{ ...inp, marginBottom: 8 }} onChange={e => { if (e.target.value) setForm(p => ({ ...p, promptText: e.target.value })); }}><option value="">-- Choose a saved prompt --</option>{prompts.map((p, i) => <option key={i} value={p.promptText}>{p.roleName}</option>)}</select><textarea rows={4} style={{ ...inp, fontSize: 12, resize: "vertical" }} placeholder="Select a prompt above or type one here..." value={form.promptText} onChange={e => setForm(p => ({ ...p, promptText: e.target.value }))} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div><label style={lbl}>Date</label><input type="date" style={inp} value={form.datetime.split("T")[0] || ""} onChange={e => setForm(p => ({ ...p, datetime: e.target.value + "T" + (p.datetime.split("T")[1] || "09:00") }))} /></div>
              <div><label style={lbl}>Time (24h)</label><input type="time" style={inp} value={form.datetime.split("T")[1] || ""} onChange={e => setForm(p => ({ ...p, datetime: (p.datetime.split("T")[0] || "") + "T" + e.target.value }))} /></div>
            </div>
            <div><label style={lbl}>Duration</label><select style={inp} value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}>{["15","30","45","60"].map(d => <option key={d} value={d}>{d} minutes</option>)}</select></div>
            {alert && <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 14, background: alert.type === "success" ? "#f0fdf4" : alert.type === "error" ? "#fef2f2" : "#eff6ff", color: alert.type === "success" ? "#16a34a" : alert.type === "error" ? "#dc2626" : "#1d4ed8" }}>{alert.msg}</div>}
            <button type="submit" disabled={loading} style={{ padding: "10px 22px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.65 : 1 }}>Create Meeting &amp; Send Invite</button>
          </form>
        </div>
        {/* Scheduled list */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h4 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px" }}>Scheduled Interviews</h4>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Candidate","Date","Attempt","Status",""].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
            <tbody>
              {scheduled.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", color: "#64748b", padding: 24, fontSize: 13 }}>No interviews scheduled yet.</td></tr> :
                scheduled.map(iv => {
                  const [sbg, scol] = statusBg[iv.status] || ["#f1f5f9", "#64748b"];
                  return <tr key={iv._id}>
                    <td style={{ padding: "10px", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}><strong>{iv.candidateName}</strong></td>
                    <td style={{ padding: "10px", fontSize: 12, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{new Date(iv.scheduledAt).toLocaleDateString()}</td>
                    <td style={{ padding: "10px", textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>#{iv.attemptNumber || 1}</td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f1f5f9" }}><span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: sbg, color: scol }}>{iv.status}</span></td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f1f5f9" }}>
                      {iv.status === "pending" ? <button onClick={async () => { if (!confirm("Cancel?")) return; await fetch(`${BASE}/api/interviews/${iv._id}/cancel`, { method: "POST", headers: { Authorization: auth() } }); fetch(`${BASE}/api/interviews/scheduled`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setScheduled(d.interviews || [])); }} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", padding: "4px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer" }}>Cancel</button> : "—"}
                    </td>
                  </tr>;
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: PROMPT GENERATOR ───────────────────────────────────────────────
function PromptGenerator() {
  const [tab, setTab] = useState<"role" | "docs">("role");
  const [roleInput, setRoleInput] = useState("");
  const [docRole, setDocRole] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [alert, setAlert] = useState<{ msg: string; type: string } | null>(null);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [library, setLibrary] = useState<Prompt[]>([]);

  useEffect(() => { fetch(`${BASE}/api/prompts`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setLibrary(d.prompts || [])); }, []);

  async function genByRole() {
    if (!roleInput.trim()) { setAlert({ msg: "Enter a role name.", type: "error" }); return; }
    setLoading(true); setAlert({ msg: "Generating with OpenAI...", type: "info" }); setResult("");
    try {
      const res = await fetch(`${BASE}/api/prompts/generate`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth() }, body: JSON.stringify({ role_name: roleInput.trim() }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setAlert({ msg: `Prompt for "${d.role_name}" generated and saved.`, type: "success" }); setResult(d.prompt_text);
      fetch(`${BASE}/api/prompts`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setLibrary(d.prompts || []));
    } catch (err: unknown) { setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" }); }
    finally { setLoading(false); }
  }

  const inp: React.CSSProperties = { width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <div><h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>AI Prompt Engineer</h3><p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>Generate a tailored interviewer prompt from a role name or uploaded documents.</p></div>
        <div style={{ display: "flex", gap: 4, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 10, padding: 4 }}>
          {(["role", "docs"] as const).map(t => <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "9px 12px", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", background: tab === t ? "#7c3aed" : "transparent", color: tab === t ? "#fff" : "#64748b" }}>{t === "role" ? "By Role Name" : "From CV + JD"}</button>)}
        </div>
        {tab === "role" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={inp} placeholder="e.g. Senior Frontend Engineer" value={roleInput} onChange={e => setRoleInput(e.target.value)} />
            <button onClick={genByRole} disabled={loading} style={{ padding: "10px 22px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.65 : 1 }}>Generate Prompt</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={inp} placeholder="Role name (optional)" value={docRole} onChange={e => setDocRole(e.target.value)} />
            <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Candidate CV</label><input type="file" accept=".pdf,.txt,.doc,.docx" style={{ ...inp, cursor: "pointer" }} onChange={e => setCvFile(e.target.files?.[0] || null)} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Job Description</label><input type="file" accept=".pdf,.txt,.doc,.docx" style={{ ...inp, cursor: "pointer" }} onChange={e => setJdFile(e.target.files?.[0] || null)} /></div>
            <button disabled={loading} onClick={async () => {
              if (!cvFile && !jdFile) { setAlert({ msg: "Upload at least one document.", type: "error" }); return; }
              setLoading(true); setAlert({ msg: "Generating from documents...", type: "info" }); setResult("");
              try {
                const fd = new FormData();
                if (cvFile) fd.append("cv_file", cvFile);
                if (jdFile) fd.append("jd_file", jdFile);
                fd.append("role_name", docRole);
                const res = await fetch(`${BASE}/api/prompts/generate-from-docs`, { method: "POST", headers: { Authorization: auth() }, body: fd });
                const d = await res.json();
                if (!res.ok) throw new Error(d.detail || "Failed");
                setAlert({ msg: "Prompt generated from documents and saved.", type: "success" }); setResult(d.prompt_text);
                fetch(`${BASE}/api/prompts`, { headers: { Authorization: auth() } }).then(r => r.json()).then(d => setLibrary(d.prompts || []));
              } catch (err: unknown) { setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" }); }
              finally { setLoading(false); }
            }} style={{ padding: "10px 22px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.65 : 1 }}>Generate from Documents</button>
          </div>
        )}
        {alert && <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 14, background: alert.type === "success" ? "#f0fdf4" : alert.type === "error" ? "#fef2f2" : "#eff6ff", color: alert.type === "success" ? "#16a34a" : alert.type === "error" ? "#dc2626" : "#1d4ed8" }}>{alert.msg}</div>}
        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Generated Prompt</label>
            <textarea rows={8} readOnly value={result} style={{ ...inp, fontSize: 13, lineHeight: 1.6, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => navigator.clipboard.writeText(result)} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>📋 Copy</button>
              <button onClick={() => { document.getElementById("meeting-input-hidden")?.dispatchEvent(new CustomEvent("setprompt", { detail: result })); }} style={{ flex: 1, padding: "10px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Use in Meeting</button>
            </div>
          </div>
        )}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 28 }}>
        <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Role Prompt Library</h3>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>Quickly copy or load system prompts for standard roles.</p>
        <div style={{ maxHeight: 480, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {library.length === 0 ? <p style={{ color: "#64748b", textAlign: "center", padding: 24 }}>No saved prompts yet.</p> :
            library.map(p => (
              <div key={p._id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{p.roleName}</div>
                <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 10 }}>{(p.promptText || "").slice(0, 140)}…</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => navigator.clipboard.writeText(p.promptText)} style={{ padding: "7px 14px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📋 Copy</button>
                  <button onClick={() => setResult(p.promptText)} style={{ padding: "7px 14px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Use in Meeting</button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("interview");
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "/login"; return; }
    checkSession().then(ok => {
      if (!ok) { localStorage.removeItem("token"); localStorage.removeItem("user"); window.location.href = "/login"; return; }
      setUser(getUser());
    });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "interview", label: "Interview Room" },
    { id: "history", label: "Past Transcripts" },
    { id: "schedule", label: "Schedule" },
    { id: "prompts", label: "Prompt Generator" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(circle at top right, rgba(139,92,246,0.04), transparent 50%), #f8fafc", display: "flex", flexDirection: "column" }}>
      {/* Navbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 40px", borderBottom: "1px solid #e2e8f0", background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 100 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={36} height={36} style={{ objectFit: "contain" }} />
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: "#0f172a", margin: 0 }}>RecruitX AI Interviewer</h2>
        </Link>
        <div style={{ display: "flex", gap: 8, background: "#f1f5f9", border: "1px solid #e2e8f0", padding: 4, borderRadius: 12 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, color: tab === t.id ? "#fff" : "#64748b", borderRadius: 8, cursor: "pointer", border: "none", background: tab === t.id ? "#8b5cf6" : "transparent", boxShadow: tab === t.id ? "0 4px 12px rgba(139,92,246,.25)" : "none", transition: "all .2s" }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {user && <div style={{ textAlign: "right" }}><div style={{ fontSize: 14, fontWeight: 600 }}>{user.name}</div><div style={{ fontSize: 12, color: "#64748b" }}>{user.email}</div></div>}
          <button onClick={logout} style={{ padding: "8px 14px", background: "transparent", border: "1px solid #e2e8f0", color: "#64748b", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer" }}>Sign Out</button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 40, maxWidth: 1400, width: "100%", margin: "0 auto" }}>
        {tab === "interview" && <InterviewRoom />}
        {tab === "history" && <PastTranscripts />}
        {tab === "schedule" && <ScheduleTab />}
        {tab === "prompts" && <PromptGenerator />}
      </div>
    </div>
  );
}
