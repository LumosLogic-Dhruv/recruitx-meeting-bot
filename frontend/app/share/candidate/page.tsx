"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import Scorecard from "../../../components/Scorecard";
import { ThemeToggle } from "../../../components/ThemeToggle";
import AIReport from "../../../components/AIReport";
import Clips from "../../../components/Clips";
import TranscriptChat from "../../../components/TranscriptChat";
import { getRecommendationLabel } from "../../../lib/useCasePresets";

type CallTab = "scorecard" | "ai-report" | "clips" | "transcript";

function formatCtc(val?: number | null) {
  if (!val) return null;
  return `₹${val} LPA`;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex gap-3">
      <span className="text-xs text-fg-muted w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-fg">{value}</span>
    </div>
  );
}

function ScoreChip({ score }: { score: number }) {
  const color =
    score >= 8 ? "#22c55e" : score >= 6 ? "var(--color-accent)" : score >= 4 ? "#f59e0b" : "#ef4444";
  return (
    <span className="text-2xl font-bold" style={{ color }}>
      {score.toFixed(1)}<span className="text-sm font-normal text-fg-muted">/10</span>
    </span>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="bg-surface-sunken rounded-xl border border-outline/10 p-10 text-center text-sm text-fg-muted">
      {label}
    </div>
  );
}

function ShareNav() {
  return (
    <header className="border-b border-outline/10 bg-surface-1/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center text-on-accent text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold text-fg">RecruitX</span>
        </a>
        <div className="flex items-center gap-4">
          <span className="text-xs text-fg-muted hidden sm:inline">Shared Candidate Profile</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

async function downloadResume(url: string, filename: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

function InlineResumeCard({ url, candidateName, role }: { url: string; candidateName?: string; role?: string }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    const namePart = candidateName?.trim().replace(/\s+/g, "_") || "Candidate";
    const rolePart = role?.trim().replace(/\s+/g, "_") || "Resume";
    const filename = `${namePart}_${rolePart}_Resume.pdf`;
    try {
      await downloadResume(url, filename);
    } catch {
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-surface-1 border border-outline/10 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3">Resume</h2>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent border border-accent/20 rounded-lg text-sm hover:bg-accent/20 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        View Resume
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface-1 border border-outline/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ width: "min(900px, 95vw)", height: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-outline/10 flex-shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <svg className="w-4 h-4 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Resume
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="text-xs text-fg-muted hover:text-accent transition-colors disabled:opacity-50"
                >
                  {downloading ? "Downloading…" : "Download"}
                </button>
                <button onClick={() => setOpen(false)} className="text-fg-muted hover:text-fg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <iframe src={url} className="flex-1 w-full flex-grow bg-white" title="Resume" />
          </div>
        </div>
      )}
    </div>
  );
}

type CallData = {
  _id: string;
  createdAt: number;
  duration: number;
  status?: string | null;
  scorecard?: Record<string, unknown> | null;
  aiReport?: unknown;
  clips?: { timestamp: string; timestampSeconds: number; description: string }[] | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  useCase?: string | null;
};

function InterviewCard({
  call,
  index,
  total,
  candidateName,
}: {
  call: CallData;
  index: number;
  total: number;
  candidateName: string;
}) {
  const scorecard = call.scorecard as any;
  const aiReport = call.aiReport ?? null;
  const clips = call.clips as { timestamp: string; timestampSeconds: number; description: string }[] | null;
  const useCase = call.useCase ?? undefined;

  const rec = (scorecard as { recommendation?: string } | null)?.recommendation ?? null;
  const recInfo = rec ? getRecommendationLabel(useCase, rec) : null;

  const tabs: { key: CallTab; label: string; show: boolean }[] = [
    { key: "scorecard", label: "Scorecard", show: !!scorecard },
    { key: "ai-report", label: "AI Report", show: !!aiReport },
    { key: "clips", label: "Clips", show: !!(clips && clips.length > 0) },
    { key: "transcript", label: "Transcript & Recording", show: !!(call.transcript || call.recordingUrl) },
  ];

  const visibleTabs = tabs.filter((t) => t.show);
  const defaultTab = visibleTabs[0]?.key ?? "scorecard";
  const [activeTab, setActiveTab] = useState<CallTab>(defaultTab);

  return (
    <div className="bg-surface-1 border border-outline/10 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-outline/10 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">Interview #{total - index}</p>
          <p className="text-xs text-fg-muted">
            {new Date(call.createdAt).toLocaleDateString(undefined, {
              year: "numeric", month: "short", day: "numeric",
            })} · {formatDuration(call.duration)}
          </p>
          {recInfo && (
            <span
              className="mt-1.5 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full"
              style={{ color: recInfo.color, background: `${recInfo.color}18` }}
            >
              {recInfo.label}
            </span>
          )}
        </div>
        {scorecard && scorecard.overall_score !== undefined && (
          <ScoreChip score={(scorecard as { overall_score: number }).overall_score} />
        )}
      </div>

      {visibleTabs.length > 0 && (
        <>
          <div className="flex gap-1 border-b border-outline/10 overflow-x-auto px-5">
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] whitespace-nowrap ${
                  activeTab === t.key
                    ? "border-accent text-accent"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {activeTab === "scorecard" && (
              scorecard ? (
                <Scorecard
                  scorecard={scorecard}
                  contactName={candidateName}
                  useCase={useCase}
                />
              ) : (
                <EmptyBlock label="No scorecard was generated for this interview." />
              )
            )}

            {activeTab === "ai-report" && (
              aiReport ? (
                <AIReport report={aiReport as any} />
              ) : (
                <EmptyBlock label="No AI report was generated for this interview." />
              )
            )}

            {activeTab === "clips" && (
              clips && clips.length > 0 ? (
                <Clips
                  clips={clips}
                  recordingUrl={call.recordingUrl ?? undefined}
                  duration={call.duration}
                  contactName={candidateName}
                />
              ) : (
                <EmptyBlock label="No clips were generated for this interview." />
              )
            )}

            {activeTab === "transcript" && (
              <div className="space-y-4">
                {call.recordingUrl && (
                  <div className="bg-surface-sunken rounded-xl border border-outline/10 p-4">
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
                      <span className="text-xs text-fg-muted">{formatDuration(call.duration)}</span>
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
                  <div className="bg-surface-sunken rounded-xl border border-outline/10 p-5">
                    <div className="max-h-[600px] overflow-y-auto px-2">
                      <TranscriptChat
                        transcript={call.transcript}
                        contactName={candidateName}
                      />
                    </div>
                  </div>
                ) : (
                  <EmptyBlock label="No transcript was captured for this interview." />
                )}
              </div>
            )}
          </div>
        </>
      )}

      {visibleTabs.length === 0 && (
        <div className="p-5">
          <EmptyBlock label="No interview data available yet." />
        </div>
      )}
    </div>
  );
}

function CandidateShareContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  
  const [data, setData] = useState<any>(undefined);

  useEffect(() => {
    if (token && process.env.NEXT_PUBLIC_CONVEX_URL) {
      const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
      convex.query("candidates:getByShareToken" as any, { token })
        .then(res => setData(res))
        .catch(() => setData(null));
    } else {
      setData(null);
    }
  }, [token]);

  if (!token) {
    return <InvalidLink reason="No share token in the URL." />;
  }

  if (data === undefined) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <div className="text-sm text-fg-muted">Loading profile…</div>
      </div>
    );
  }

  if (data === null) {
    return <InvalidLink reason="This share link is invalid or has been revoked." />;
  }

  const interviewCalls = data.calls ? data.calls.filter(
    (c: any) =>
      c.scorecard ||
      c.aiReport ||
      (c.clips && c.clips.length > 0) ||
      c.transcript ||
      c.recordingUrl
  ) : [];

  const callsWithScorecard = interviewCalls.filter((c: any) => c.scorecard && c.scorecard.overall_score !== undefined);

  return (
    <div className="min-h-screen bg-surface-base">
      <ShareNav />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <section className="bg-surface-1 border border-outline/10 rounded-2xl p-6 sm:p-8">
          <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-1">Candidate Profile</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-fg">{data.name}</h1>
          {data.roleApplyingFor && (
            <p className="text-sm text-accent font-medium mt-1">Applying for: {data.roleApplyingFor}</p>
          )}
          {(data.currentTitle || data.currentCompany) && (
            <p className="text-sm text-fg-muted mt-0.5">
              {[data.currentTitle, data.currentCompany].filter(Boolean).join(" @ ")}
            </p>
          )}

          {callsWithScorecard.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-surface-sunken rounded-lg border border-outline/10">
                <span className="text-xs text-fg-muted">Best Score</span>
                <ScoreChip
                  score={Math.max(...callsWithScorecard.map((c: any) => c.scorecard.overall_score))}
                />
              </div>
              <span className="text-xs text-fg-muted">
                {interviewCalls.length} interview{interviewCalls.length !== 1 ? "s" : ""} completed
              </span>
            </div>
          )}
        </section>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-surface-1 border border-outline/10 rounded-xl p-5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Contact</h2>
            <InfoRow label="Email" value={data.email} />
            <InfoRow label="Phone" value={data.phone} />
            <InfoRow label="Location" value={data.location} />
          </div>
          <div className="bg-surface-1 border border-outline/10 rounded-xl p-5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Professional</h2>
            <InfoRow label="Experience" value={data.experienceYears != null ? `${data.experienceYears} years` : null} />
            <InfoRow label="Current CTC" value={formatCtc(data.currentCtc)} />
            <InfoRow label="Expected CTC" value={formatCtc(data.expectedCtc)} />
            <InfoRow label="Notice Period" value={data.noticePeriodDays != null ? `${data.noticePeriodDays} days` : null} />
          </div>
        </div>

        {data.skills && data.skills.length > 0 && (
          <div className="bg-surface-1 border border-outline/10 rounded-xl p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3">Skills</h2>
            <div className="flex flex-wrap gap-2">
              {data.skills.map((s: string) => (
                <span key={s} className="px-2.5 py-1 text-xs bg-accent/10 text-accent rounded-full border border-accent/20">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {data.education && data.education.length > 0 && (
          <div className="bg-surface-1 border border-outline/10 rounded-xl p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-4">Education</h2>
            <div className="space-y-4">
              {data.education.map((edu: any, i: number) => (
                <div key={i} className={i > 0 ? "pt-4 border-t border-outline/10" : ""}>
                  <p className="font-medium text-fg">{edu.institution}</p>
                  <p className="text-sm text-fg-muted">
                    {[edu.degree, edu.field].filter(Boolean).join(" in ")}
                  </p>
                  <p className="text-xs text-fg-muted mt-1">
                    {[
                      edu.city,
                      edu.startYear && edu.endYear ? `${edu.startYear} – ${edu.endYear}` : edu.endYear ? String(edu.endYear) : null,
                      edu.score ? `Score: ${edu.score}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.experience && data.experience.length > 0 && (
          <div className="bg-surface-1 border border-outline/10 rounded-xl p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-4">Work Experience</h2>
            <div className="space-y-4">
              {data.experience.map((exp: any, i: number) => (
                <div key={i} className={i > 0 ? "pt-4 border-t border-outline/10" : ""}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-fg">{exp.designation}</p>
                      <p className="text-sm text-fg-muted">{exp.company}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-fg-muted">
                        {exp.startYear ?? "?"} – {exp.isCurrent ? "Present" : (exp.endYear ?? "?")}
                      </p>
                      {exp.ctc && <p className="text-xs text-fg-muted">₹{exp.ctc} LPA</p>}
                    </div>
                  </div>
                  {exp.description && (
                    <p className="text-sm text-fg-muted mt-2">{exp.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.projects && data.projects.length > 0 && (
          <div className="bg-surface-1 border border-outline/10 rounded-xl p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-4">Projects</h2>
            <div className="space-y-4">
              {data.projects.map((proj: any, i: number) => (
                <div key={i} className={i > 0 ? "pt-4 border-t border-outline/10" : ""}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-fg">{proj.name}</p>
                    {proj.duration && <span className="text-xs text-fg-muted">{proj.duration}</span>}
                  </div>
                  {proj.description && <p className="text-sm text-fg-muted mt-1">{proj.description}</p>}
                  {proj.link && (
                    <a href={proj.link} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline mt-1 inline-block">
                      {proj.link}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.resumeUrl && <InlineResumeCard url={data.resumeUrl} candidateName={data.name} role={data.roleApplyingFor} />}

        {interviewCalls.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-fg mb-4">Interview Assessments</h2>
            <div className="space-y-6">
              {interviewCalls.map((call: any, i: number) => (
                <InterviewCard
                  key={call._id}
                  call={call as CallData}
                  index={i}
                  total={interviewCalls.length}
                  candidateName={data.name}
                />
              ))}
            </div>
          </div>
        )}

        <footer className="pt-6 border-t border-outline/10 text-center pb-8">
          <p className="text-xs text-fg-muted">
            Profile shared via{" "}
            <a href="/" target="_blank" rel="noopener noreferrer"
              className="text-accent hover:underline">
              RecruitX
            </a>
            {" "}— AI-powered candidate screening for recruitment agencies.
          </p>
        </footer>
      </main>
    </div>
  );
}

function InvalidLink({ reason }: { reason: string }) {
  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="bg-surface-1 border border-outline/10 rounded-xl p-8 w-full max-w-md text-center">
        <h1 className="text-xl font-bold text-fg mb-2">Link Unavailable</h1>
        <p className="text-sm text-fg-muted mb-6">{reason}</p>
        <a href="/" className="inline-block px-6 py-2.5 rounded-lg text-sm font-medium text-on-accent bg-gradient-to-br from-accent to-accent-2 hover:opacity-90 transition-opacity">
          Visit RecruitX
        </a>
      </div>
    </div>
  );
}

export default function CandidateSharePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <div className="text-sm text-fg-muted">Loading…</div>
      </div>
    }>
      <CandidateShareContent />
    </Suspense>
  );
}
