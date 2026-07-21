"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RecordingStatus {
  status:           "pending" | "processing" | "available" | "failed" | "not_found" | "error" | "unavailable";
  available:        boolean;
  recording_url?:   string;
  duration_seconds?: number;
  created_at?:      number;
  bot_included?:    boolean;
  diarization?:     boolean;
}

interface Props {
  meetingId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDuration(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

const G = "rgba(255,255,255,";
const card: React.CSSProperties = {
  background: `${G}0.05)`,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${G}0.09)`,
  borderRadius: 14,
  padding: "20px 24px",
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function RecordingTab({ meetingId }: Props) {
  const [status, setStatus]     = useState<RecordingStatus | null>(null);
  const [loading, setLoading]   = useState(true);
  const [speed, setSpeed]       = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch status ────────────────────────────────────────────────────────────

  async function fetchStatus() {
    try {
      const r = await api(`/api/meetings/${meetingId}/recording/status`);
      if (!r.ok) return;
      const d: RecordingStatus = await r.json();
      setStatus(d);
      setLoading(false);

      // Stop polling once recording is available or permanently failed
      if (d.available || d.status === "failed" || d.status === "not_found") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    // Poll every 15 seconds while recording is still processing
    pollRef.current = setInterval(fetchStatus, 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [meetingId]);

  // ── Playback speed ──────────────────────────────────────────────────────────

  function changeSpeed(s: number) {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  }

  function toggleFullscreen() {
    if (!videoRef.current) return;
    if (!document.fullscreenElement) {
      videoRef.current.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }

  // ── Render states ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
        Checking recording status…
      </div>
    );
  }

  const isAvailable  = status?.available && status?.recording_url;
  const isProcessing = !status?.available && status?.status !== "failed" && status?.status !== "not_found";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>

        <StatusPill status={status?.status || "pending"} />

        <Meta label="Duration"  value={fmtDuration(status?.duration_seconds ?? 0)} />
        <Meta label="Recorded"  value={fmtDate(status?.created_at)} />
        <Meta label="Bot Audio" value={status?.bot_included !== false ? "Included ✓" : "Not included"} color={status?.bot_included !== false ? "#34d399" : "#f87171"} />
        <Meta label="Diarization" value={status?.diarization !== false ? "Enabled ✓" : "Disabled"} color={status?.diarization !== false ? "#34d399" : "#94a3b8"} />
      </div>

      {/* ── Video player ────────────────────────────────────────────────────── */}
      {isAvailable ? (
        <div style={card}>
          <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 12, fontSize: 14 }}>
            Interview Recording
          </div>

          {/* Native HTML5 player */}
          <video
            ref={videoRef}
            src={status!.recording_url}
            controls
            playsInline
            style={{
              width: "100%",
              borderRadius: 10,
              background: "#000",
              maxHeight: 480,
              outline: "none",
            }}
            onLoadedMetadata={() => {
              if (videoRef.current) videoRef.current.playbackRate = speed;
            }}
          >
            Your browser does not support the video element.
          </video>

          {/* Playback speed + fullscreen controls */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#94a3b8", fontSize: 12, marginRight: 4 }}>Speed:</span>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
              <button
                key={s}
                onClick={() => changeSpeed(s)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: speed === s ? "1px solid #a78bfa" : `1px solid ${G}0.12)`,
                  background: speed === s ? "rgba(167,139,250,0.15)" : `${G}0.06)`,
                  color: speed === s ? "#a78bfa" : "#94a3b8",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: speed === s ? 700 : 400,
                }}
              >
                {s}×
              </button>
            ))}
            <button
              onClick={toggleFullscreen}
              style={{
                marginLeft: "auto",
                padding: "4px 12px",
                borderRadius: 6,
                border: `1px solid ${G}0.12)`,
                background: `${G}0.06)`,
                color: "#94a3b8",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>
        </div>
      ) : isProcessing ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 6 }}>
            Recording is still processing
          </div>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            This usually takes 2–5 minutes after the interview ends. This page refreshes automatically.
          </div>
        </div>
      ) : (
        <div style={{ ...card, textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div style={{ color: "#94a3b8", fontSize: 14 }}>
            {status?.status === "failed"
              ? "Recording failed. The interview transcript and scorecard are still available."
              : "No recording found for this interview."}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string, string]> = {
    available:   ["rgba(52,211,153,0.15)",  "#34d399", "Available"],
    processing:  ["rgba(251,191,36,0.15)",  "#fbbf24", "Processing…"],
    pending:     ["rgba(148,163,184,0.12)", "#94a3b8", "Pending"],
    failed:      ["rgba(248,113,113,0.15)", "#f87171", "Failed"],
    not_found:   ["rgba(148,163,184,0.12)", "#94a3b8", "Not Found"],
    error:       ["rgba(248,113,113,0.15)", "#f87171", "Error"],
    unavailable: ["rgba(148,163,184,0.12)", "#94a3b8", "Unavailable"],
  };
  const [bg, col, label] = map[status] ?? ["rgba(148,163,184,0.12)", "#94a3b8", status];
  return (
    <span style={{
      padding: "5px 14px",
      borderRadius: 20,
      background: bg,
      color: col,
      fontSize: 12,
      fontWeight: 700,
    }}>
      {label}
    </span>
  );
}

function Meta({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: color || "#e2e8f0", fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
