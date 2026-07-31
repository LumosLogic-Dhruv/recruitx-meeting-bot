"use client";

import { useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";

interface Clip {
  timestamp: string;
  timestampSeconds: number;
  description: string;
}

interface Props {
  clips: Clip[];
  recordingUrl?: string;
  duration?: number;
  contactName?: string;
}

function encodeWAV(buffer: AudioBuffer): Blob {
  const nc = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const samples = new Int16Array(len * nc);
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nc; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      samples[i * nc + ch] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  const wavBuf = new ArrayBuffer(44 + samples.byteLength);
  const dv = new DataView(wavBuf);
  const ws = (o: number, str: string) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + samples.byteLength, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, nc, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true);
  dv.setUint16(34, 16, true); ws(36, "data");
  dv.setUint32(40, samples.byteLength, true);
  new Int16Array(wavBuf, 44).set(samples);
  return new Blob([wavBuf], { type: "audio/wav" });
}

export default function Clips({ clips, recordingUrl, duration, contactName }: Props) {
  const authToken = useAuthToken();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [downloading, setDownloading] = useState<Record<number, boolean>>({});

  // Filter out clips whose timestamps exceed the actual recording duration.
  // This covers existing DB records that were generated before the timeline bug fix.
  const validClips = duration
    ? clips.filter((c) => c.timestampSeconds < duration)
    : clips;
  const invalidCount = clips.length - validClips.length;

  function seekTo(seconds: number) {
    if (!audioRef.current || !recordingUrl) return;
    const clamped = duration ? Math.min(seconds, duration - 1) : seconds;
    audioRef.current.currentTime = clamped;
    audioRef.current.play().catch(() => {});
  }

  async function downloadClip(clip: Clip, index: number) {
    if (!recordingUrl) return;
    setDownloading((prev) => ({ ...prev, [index]: true }));
    try {
      // Fetch through Convex proxy to bypass browser CORS restrictions on the audio host.
      const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
      const proxyUrl = `${convexSiteUrl}/proxy-audio?url=${encodeURIComponent(recordingUrl)}`;
      const res = await fetch(proxyUrl, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);

      const arrayBuf = await res.arrayBuffer();
      const AudioCtx = window.AudioContext || ((window as unknown) as Record<string, unknown>).webkitAudioContext as typeof AudioContext;
      const ctx = new AudioCtx();
      const fullBuffer = await ctx.decodeAudioData(arrayBuf);

      const clipStart = Math.max(0, clip.timestampSeconds - 5);
      const clipEnd = Math.min(fullBuffer.duration, clip.timestampSeconds + 55);
      const clipLen = Math.floor((clipEnd - clipStart) * fullBuffer.sampleRate);

      const clipBuffer = ctx.createBuffer(fullBuffer.numberOfChannels, clipLen, fullBuffer.sampleRate);
      const startSample = Math.floor(clipStart * fullBuffer.sampleRate);
      for (let ch = 0; ch < fullBuffer.numberOfChannels; ch++) {
        const src = fullBuffer.getChannelData(ch);
        const dst = clipBuffer.getChannelData(ch);
        for (let i = 0; i < clipLen; i++) dst[i] = src[startSample + i] ?? 0;
      }

      const blob = encodeWAV(clipBuffer);
      const safeName = (contactName ?? "candidate").replace(/[^a-z0-9]/gi, "_");
      const safeTs = clip.timestamp.replace(":", "m") + "s";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `Clip_${safeName}_${safeTs}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("downloadClip error:", err);
    } finally {
      setDownloading((prev) => ({ ...prev, [index]: false }));
    }
  }

  return (
    <div className="space-y-4">
      {/* Audio player */}
      {recordingUrl && (
        <div className="bg-surface-1 rounded-xl border border-outline/10 p-4">
          <div className="flex items-center gap-3 mb-3">
            <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            <h3 className="text-sm font-semibold text-fg">Call Recording</h3>
            <span className="text-xs text-fg-muted">Click a timestamp to jump to that moment</span>
          </div>
          <audio ref={audioRef} controls className="w-full" src={recordingUrl}>
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {/* Warning for clipped-out invalid timestamps */}
      {invalidCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {invalidCount} highlight{invalidCount > 1 ? "s were" : " was"} beyond the recording length and hidden — regenerate clips to fix this.
        </div>
      )}

      {/* Clips list */}
      <div className="bg-surface-1 rounded-xl border border-outline/10 divide-y divide-outline/10">
        <div className="px-5 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">Key Moments</h3>
          <span className="text-xs text-fg-muted">{validClips.length} highlights</span>
        </div>

        {validClips.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-fg-muted">
            No highlights found
          </div>
        ) : (
          validClips.map((clip, i) => (
            <div key={i} className="flex gap-4 px-5 py-4 items-start hover:bg-surface-1/50 transition-colors">
              {/* Play thumbnail */}
              <div
                className={`w-16 h-12 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0 ${recordingUrl ? "cursor-pointer hover:bg-accent/10 transition-colors" : ""}`}
                onClick={() => recordingUrl && seekTo(clip.timestampSeconds)}
                title={recordingUrl ? `Jump to ${clip.timestamp}` : undefined}
              >
                {recordingUrl ? (
                  <svg className="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-fg leading-relaxed">{clip.description}</p>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <button
                    className="inline-flex items-center gap-1 text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted hover:bg-accent/10 hover:text-accent transition-colors"
                    onClick={() => recordingUrl && seekTo(clip.timestampSeconds)}
                    disabled={!recordingUrl}
                    title={recordingUrl ? `Jump to ${clip.timestamp}` : "No recording available"}
                  >
                    {clip.timestamp}
                  </button>

                  {recordingUrl && (
                    <button
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
                        downloading[i]
                          ? "border-outline/10 text-fg-muted cursor-wait"
                          : "border-outline/20 text-fg-muted hover:border-accent hover:text-accent"
                      }`}
                      onClick={() => !downloading[i] && downloadClip(clip, i)}
                      title="Download this ~60s clip as WAV"
                      disabled={downloading[i]}
                    >
                      {downloading[i] ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Preparing…
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download Clip
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
