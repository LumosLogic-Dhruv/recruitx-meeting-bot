"use client";

import { useState } from "react";
import RadarChart from "./RadarChart";
import { getRecommendationLabel } from "../lib/useCasePresets";

interface Skill {
  name: string;
  score: number;
  notes: string;
}

interface Dimension {
  name: string;
  score: number;
}

interface DetailedDimensionBullet {
  timestamp: string;
  text: string;
}

interface DetailedDimension {
  name: string;
  score: number; // 1-5
  insight: string;
  bulletPoints: DetailedDimensionBullet[];
}

interface ScorecardData {
  overall_score: number;
  recommendation: string;
  summary: string;
  skills: Skill[];
  green_flags: string[];
  red_flags: string[];
  improvements: string[];
  dimensions?: Dimension[];
  detailedDimensions?: DetailedDimension[];
  // Legacy recruiting fields (backward compat)
  cultural_fit?: number;
  communication?: number;
  technical_depth?: number;
  experience_relevance?: number;
  enthusiasm?: number;
  problem_solving?: number;
}

interface Props {
  scorecard: ScorecardData;
  contactName: string;
  useCase?: string;
}

// Score → color band. Keep the threshold logic centralized so the gauge,
// bars, and pills all agree on what counts as "passing" (>= 6) vs "strong"
// (>= 8). The amber/red bands below 6 mirror what a recruiter would call
// "borderline" and "fail".
function scoreColor(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "var(--color-accent)";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

const PASS_THRESHOLD = 6;

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const threshPct = (PASS_THRESHOLD / max) * 100;
  const color = scoreColor(score);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        {/* Pass threshold tick — recruiters can scan for "above/below the line" */}
        <div
          className="absolute top-0 bottom-0 w-px bg-fg/40"
          style={{ left: `${threshPct}%` }}
          aria-hidden="true"
        />
      </div>
      <span className="text-xs font-mono font-bold w-6 text-right" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

// Conic-gradient ring gauge for the headline overall score. Pure CSS, no
// SVG/charting library. The center reads "8.4 / 10" with the recommendation
// label tucked underneath the ring.
function ScoreGauge({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, score / max));
  const color = scoreColor(score);
  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${color} ${pct * 360}deg, var(--color-surface-3) 0deg)`,
        }}
        aria-hidden="true"
      />
      <div className="absolute inset-[6px] rounded-full bg-surface-1 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none" style={{ color }}>
          {score.toFixed(1)}
        </span>
        <span className="text-[10px] text-fg-muted leading-none mt-0.5">/ {max}</span>
      </div>
    </div>
  );
}

export default function Scorecard({ scorecard, contactName, useCase }: Props) {
  const recInfo = getRecommendationLabel(useCase, scorecard.recommendation);

  // Build radar data from dimensions array if available, fallback to legacy fields
  const radarData: { label: string; value: number }[] = scorecard.dimensions?.length
    ? scorecard.dimensions.map((d) => ({ label: d.name, value: d.score }))
    : [
        { label: "Technical", value: scorecard.technical_depth ?? 5 },
        { label: "Communication", value: scorecard.communication ?? 5 },
        { label: "Experience", value: scorecard.experience_relevance ?? 5 },
        { label: "Problem Solving", value: scorecard.problem_solving ?? 5 },
        { label: "Enthusiasm", value: scorecard.enthusiasm ?? 5 },
        { label: "Cultural Fit", value: scorecard.cultural_fit ?? 5 },
      ];

  // Computed snapshot — top 2 strengths and bottom 2 gaps drawn from skills
  // when present, otherwise from the radar dimensions. Gives the recruiter
  // an at-a-glance verdict without parsing the radar.
  const sourceForSnapshot = scorecard.skills?.length
    ? scorecard.skills.map((s) => ({ label: s.name, value: s.score }))
    : radarData;
  const sortedByScore = [...sourceForSnapshot].sort((a, b) => b.value - a.value);
  const topStrengths = sortedByScore.slice(0, 2);
  const topGaps = sortedByScore.slice(-2).reverse();

  return (
    <div className="space-y-6">
      {/* Hero — gauge + headline verdict + summary as quote */}
      <div className="bg-surface-1 rounded-xl border border-outline/10 p-6">
        <div className="flex items-start gap-5">
          <ScoreGauge score={scorecard.overall_score} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-fg truncate">{contactName}</h2>
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                style={{
                  backgroundColor: `${recInfo.color}15`,
                  color: recInfo.color,
                }}
              >
                {recInfo.label}
              </span>
            </div>
            <p
              className="text-sm text-fg-muted mt-2 border-l-2 pl-3"
              style={{ borderColor: recInfo.color }}
            >
              {scorecard.summary}
            </p>
          </div>
        </div>

        {/* Snapshot — top strengths + top gaps, computed from skills */}
        {(topStrengths.length > 0 || topGaps.length > 0) && (
          <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-outline/10">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-2">
                Top strengths
              </p>
              <div className="space-y-1.5">
                {topStrengths.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-fg truncate">{s.label}</span>
                    <span
                      className="font-mono font-bold tabular-nums"
                      style={{ color: scoreColor(s.value) }}
                    >
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-2">
                Top gaps
              </p>
              <div className="space-y-1.5">
                {topGaps.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-fg truncate">{s.label}</span>
                    <span
                      className="font-mono font-bold tabular-nums"
                      style={{ color: scoreColor(s.value) }}
                    >
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Competency Radar — full width now that the duplicate metrics list is gone */}
      <div className="bg-surface-1 rounded-xl border border-outline/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-fg">Competency Radar</h3>
          <span className="text-[10px] text-fg-muted">Pass line at {PASS_THRESHOLD}/10</span>
        </div>
        <RadarChart data={radarData} />
      </div>

      {/* Green Flags / Red Flags */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-surface-1 rounded-xl border border-outline/10 p-6">
          <h3 className="text-sm font-semibold text-[#22c55e] mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
            Green Flags
          </h3>
          {scorecard.green_flags.length === 0 ? (
            <p className="text-xs text-fg-muted">None identified</p>
          ) : (
            <ul className="space-y-2">
              {scorecard.green_flags.map((flag, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-[#22c55e] flex-shrink-0 mt-0.5">+</span>
                  <span className="text-fg">{flag}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-surface-1 rounded-xl border border-outline/10 p-6">
          <h3 className="text-sm font-semibold text-[#ef4444] mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
            Red Flags
          </h3>
          {scorecard.red_flags.length === 0 ? (
            <p className="text-xs text-fg-muted">None identified</p>
          ) : (
            <ul className="space-y-2">
              {scorecard.red_flags.map((flag, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-[#ef4444] flex-shrink-0 mt-0.5">-</span>
                  <span className="text-fg">{flag}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Skill Breakdown */}
      <div className="bg-surface-1 rounded-xl border border-outline/10 p-6">
        <h3 className="text-sm font-semibold text-fg mb-4">Skill Breakdown</h3>
        <div className="space-y-4">
          {scorecard.skills.map((skill, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-fg">{skill.name}</span>
              </div>
              <ScoreBar score={skill.score} />
              {skill.notes && (
                <p className="text-xs text-fg-muted mt-1 pl-1">{skill.notes}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Things to Improve */}
      <div className="bg-surface-1 rounded-xl border border-outline/10 p-6">
        <h3 className="text-sm font-semibold text-[#f59e0b] mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
          Areas for Improvement
        </h3>
        {scorecard.improvements.length === 0 ? (
          <p className="text-xs text-fg-muted">No specific improvements noted</p>
        ) : (
          <ul className="space-y-2">
            {scorecard.improvements.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-[#f59e0b] flex-shrink-0 mt-0.5">{i + 1}.</span>
                <span className="text-fg">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detailed Dimensional Breakdown (Noota-style accordion) */}
      {scorecard.detailedDimensions && scorecard.detailedDimensions.length > 0 && (
        <div className="space-y-0 rounded-xl border border-outline/10 overflow-hidden">
          {scorecard.detailedDimensions.map((dim, i) => (
            <DetailedDimensionRow
              key={i}
              dimension={dim}
              isLast={i === (scorecard.detailedDimensions?.length ?? 1) - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DetailedDimensionRow({ dimension, isLast }: { dimension: DetailedDimension; isLast: boolean }) {
  const [open, setOpen] = useState(false);

  // Color for score badge: 4-5 = green, 3 = amber, 1-2 = red
  const badgeColor = dimension.score >= 4 ? "#22c55e" : dimension.score >= 3 ? "#f59e0b" : "#ef4444";
  // Color for insight text: same logic
  const insightColor = dimension.score >= 4 ? "#22c55e" : dimension.score >= 3 ? "#f59e0b" : "#ef4444";

  return (
    <div className={`bg-surface-1 ${!isLast ? "border-b border-outline/10" : ""}`}>
      {/* Header row */}
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-sunken/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{dimension.name}</span>
          <span className="w-4 h-4 rounded-full border border-outline/20 flex items-center justify-center text-[9px] text-fg-muted" title="AI-assessed dimension">i</span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold"
            style={{ backgroundColor: `${badgeColor}20`, color: badgeColor }}
          >
            <span>{dimension.score}</span>
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <svg
            className={`w-4 h-4 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expandable content */}
      {open && (
        <div className="px-6 pb-5">
          {/* Insight text */}
          <p className="text-sm font-medium mb-3" style={{ color: insightColor }}>
            {dimension.insight}
          </p>
          {/* Bullet points with timestamps */}
          <ul className="space-y-2">
            {dimension.bulletPoints.map((bp, j) => (
              <li key={j} className="flex items-start gap-2.5 text-sm">
                <span className="text-fg-muted flex-shrink-0 mt-0.5">*</span>
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-accent/15 text-accent flex-shrink-0"
                >
                  {bp.timestamp}
                </span>
                <span className="text-fg">{bp.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
