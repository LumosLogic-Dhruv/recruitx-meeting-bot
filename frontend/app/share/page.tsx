"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import Scorecard from "../../components/Scorecard";
import { ThemeToggle } from "../../components/ThemeToggle";
import AIReport from "../../components/AIReport";
import Clips from "../../components/Clips";
import TranscriptChat from "../../components/TranscriptChat";
import { getRecommendationLabel } from "../../lib/useCasePresets";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL || "");

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

type ShareTab = "scorecard" | "ai-report" | "clips" | "transcript";

function SharePageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  
  const [call, setCall] = useState<any>(undefined);
  const [tab, setTab] = useState<ShareTab>("scorecard");

  useEffect(() => {
    if (token && process.env.NEXT_PUBLIC_CONVEX_URL) {
      convex.query("meetings:getByShareToken" as any, { token })
        .then(res => setCall(res))
        .catch(() => setCall(null));
    } else {
      setCall(null);
    }
  }, [token]);

  if (!token) {
    return <InvalidLink reason="No share token in the URL." />;
  }

  if (call === undefined) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <div className="text-sm text-fg-muted">Loading report…</div>
      </div>
    );
  }

  if (call === null) {
    return (
      <InvalidLink reason="This share link is invalid, has been revoked, or has expired." />
    );
  }

  const contactName = call.contactName ?? "Candidate";
  const scorecard = call.scorecard;
  const rec = scorecard?.recommendation ?? null;
  const useCase = call.useCase ?? undefined;
  const recInfo = rec ? getRecommendationLabel(useCase, rec) : null;
  const aiReport = call.aiReport ?? null;
  const clips = call.clips as { timestamp: string; timestampSeconds: number; description: string }[] | null;

  const tabs: { key: ShareTab; label: string; show: boolean }[] = [
    { key: "scorecard", label: "Scorecard", show: true },
    { key: "ai-report", label: "AI Report", show: !!aiReport },
    { key: "clips", label: "Clips", show: !!(clips && clips.length > 0) },
    { key: "transcript", label: "Transcript & Recording", show: true },
  ];

  return (
    <div className="min-h-screen bg-surface-base">
      <ShareNav />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <section className="bg-surface-1 border border-outline/10 rounded-2xl p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-1">
                AI Screening Report
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-fg truncate">
                {contactName}
              </h1>
              <p className="text-sm text-fg-muted mt-2">
                {formatDate(call.createdAt)} &middot; Call duration{" "}
                {formatDuration(call.duration)}
              </p>
              {recInfo && (
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-sunken border border-outline/10">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: recInfo.color }}
                  >
                    {recInfo.label}
                  </span>
                </div>
              )}
            </div>

            {scorecard && scorecard.overall_score !== undefined && (
              <div className="flex flex-col items-center sm:items-end shrink-0">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl sm:text-6xl font-bold bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
                    {scorecard.overall_score.toFixed(1)}
                  </span>
                  <span className="text-xl text-fg-muted">/10</span>
                </div>
                <p className="text-xs text-fg-muted mt-1 uppercase tracking-wide">
                  Overall Score
                </p>
              </div>
            )}
          </div>

          {scorecard?.summary && (
            <p className="text-sm sm:text-base text-fg leading-relaxed mt-6 pt-6 border-t border-outline/10">
              {scorecard.summary}
            </p>
          )}
        </section>

        <div className="flex gap-1 mt-8 mb-6 border-b border-outline/10 overflow-x-auto">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-[1px] whitespace-nowrap ${
                tab === t.key
                  ? "border-accent text-accent"
                  : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "scorecard" && (
          <div>
            {scorecard ? (
              <Scorecard
                scorecard={scorecard}
                contactName={contactName}
                useCase={useCase}
              />
            ) : (
              <EmptyBlock label="No scorecard was generated for this call." />
            )}
          </div>
        )}

        {tab === "ai-report" && (
          <div>
            {aiReport ? (
              <AIReport report={aiReport} />
            ) : (
              <EmptyBlock label="No AI report was generated for this call." />
            )}
          </div>
        )}

        {tab === "clips" && (
          <div>
            {clips && clips.length > 0 ? (
              <Clips
                clips={clips}
                recordingUrl={call.recordingUrl ?? undefined}
                duration={call.duration}
                contactName={contactName}
              />
            ) : (
              <EmptyBlock label="No clips were generated for this call." />
            )}
          </div>
        )}

        {tab === "transcript" && (
          <div className="space-y-4">
            {call.recordingUrl && (
              <div className="bg-surface-1 rounded-xl border border-outline/10 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <svg
                    className="w-4 h-4 text-accent"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
                    />
                  </svg>
                  <h3 className="text-sm font-semibold text-fg">Call Recording</h3>
                  <span className="text-xs text-fg-muted">
                    {formatDuration(call.duration)}
                  </span>
                  <a
                    href={call.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-xs text-accent hover:underline"
                  >
                    Download
                  </a>
                </div>
                <audio controls className="w-full" src={call.recordingUrl}>
                  Your browser does not support the audio element.
                </audio>
              </div>
            )}

            {call.transcript ? (
              <div className="bg-surface-1 rounded-xl border border-outline/10 p-5">
                <div className="max-h-[600px] overflow-y-auto px-2">
                  <TranscriptChat
                    transcript={call.transcript}
                    contactName={contactName}
                  />
                </div>
              </div>
            ) : (
              <EmptyBlock label="No transcript was captured for this call." />
            )}
          </div>
        )}

        <ShareFooter />
      </main>
    </div>
  );
}

function ShareNav() {
  return (
    <header className="border-b border-outline/10 bg-surface-1/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center text-on-accent text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold text-fg">RecruitX</span>
        </a>
        <div className="flex items-center gap-4">
          <span className="text-xs text-fg-muted hidden sm:inline">
            Shared AI screening report
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function ShareFooter() {
  return (
    <footer className="mt-12 pt-6 border-t border-outline/10 text-center pb-8">
      <p className="text-xs text-fg-muted">
        This report was generated by{" "}
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          RecruitX
        </a>
        {" "}— AI-powered candidate screening for recruitment agencies.
      </p>
    </footer>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="bg-surface-1 rounded-xl border border-outline/10 p-12 text-center text-sm text-fg-muted">
      {label}
    </div>
  );
}

function InvalidLink({ reason }: { reason: string }) {
  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="bg-surface-1 border border-outline/10 rounded-xl p-8 w-full max-w-md text-center shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-[#ef4444]/10 flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-[#ef4444]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-fg mb-2">Link Unavailable</h1>
        <p className="text-sm text-fg-muted mb-6">{reason}</p>
        <a
          href="/"
          className="inline-block px-6 py-2.5 rounded-lg text-sm font-medium text-on-accent bg-gradient-to-br from-accent to-accent-2 hover:opacity-90 transition-opacity"
        >
          Visit RecruitX
        </a>
      </div>
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-base flex items-center justify-center">
          <div className="text-sm text-fg-muted">Loading…</div>
        </div>
      }
    >
      <SharePageContent />
    </Suspense>
  );
}
