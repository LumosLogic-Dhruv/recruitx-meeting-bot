"use client";

interface TechnicalSkill {
  name: string;
  level: "strong" | "moderate" | "basic" | "unknown";
  description: string;
  timestamp?: string;
}

interface PastExperience {
  projectTitle: string;
  timeSpent: string;
  objectives: string[];
  achievements: string[];
  reasonForChange?: string;
}

interface NextStep {
  action: string;
  owner: string;
  timeline: string;
  timestamp?: string | null;
}

interface AIReportData {
  candidateOverview: {
    name: string;
    position: string;
    expectedSalary: string;
    yearsOfExperience: string;
    whyInterested: string;
  };
  pastExperience: PastExperience[];
  technicalSkills: TechnicalSkill[];
  softSkills: TechnicalSkill[];
  nextSteps: NextStep[];
}

interface Props {
  report: AIReportData;
}

const LEVEL_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  strong:   { emoji: "✅", color: "#22c55e", label: "Strong" },
  moderate: { emoji: "🟠", color: "#f59e0b", label: "Moderate" },
  basic:    { emoji: "🟠", color: "#f59e0b", label: "Basic" },
  unknown:  { emoji: "❓", color: "#6b7280", label: "Unknown" },
};

function TimestampBadge({ ts }: { ts?: string | null }) {
  if (!ts) return null;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-accent/15 text-accent ml-1.5">
      {ts}
    </span>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 rounded-xl border border-outline/10 p-6">
      <h3 className="text-base font-bold text-fg mb-4">{title}</h3>
      {children}
    </div>
  );
}

// Convex document IDs are 20+ char lowercase-alphanumeric strings — not human-readable.
// If a field was stored with an ID instead of a real value, show a fallback.
function sanitizeField(value: string | undefined | null): string {
  if (!value) return "Not specified";
  return /^[a-z0-9]{20,}$/.test(value.trim()) ? "Not specified" : value;
}

export default function AIReport({ report }: Props) {
  const { candidateOverview: ov, pastExperience, technicalSkills, softSkills, nextSteps } = report;

  return (
    <div className="space-y-5">
      {/* Candidate Overview */}
      <SectionCard title="Candidate Overview">
        <div className="space-y-2 text-sm">
          <Row label="Candidate Name" value={sanitizeField(ov.name)} />
          <Row label="Position Applied For" value={sanitizeField(ov.position)} />
          <Row label="Expected Salary" value={sanitizeField(ov.expectedSalary)} />
          <Row label="Years of Experience" value={sanitizeField(ov.yearsOfExperience)} />
          <Row label="Why Interested" value={sanitizeField(ov.whyInterested)} />
        </div>
      </SectionCard>

      {/* Past Experience */}
      {pastExperience?.length > 0 && (
        <SectionCard title="Past Experience Match">
          <div className="space-y-6">
            {pastExperience.map((exp, i) => (
              <div key={i} className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-fg">{exp.projectTitle}</p>
                  <p className="text-xs text-fg-muted">
                    <span className="font-medium">Time Spent:</span> {exp.timeSpent}
                  </p>
                </div>
                {exp.objectives?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-fg-muted mb-1.5">Key Objectives and Missions:</p>
                    <ul className="space-y-1">
                      {exp.objectives.map((obj, j) => (
                        <li key={j} className="flex gap-2 text-sm text-fg pl-2 border-l-2 border-outline/20">
                          <span>{obj}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {exp.achievements?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-fg-muted mb-1.5">Key Goals and Achievements:</p>
                    <ul className="space-y-1">
                      {exp.achievements.map((ach, j) => (
                        <li key={j} className="flex gap-2 text-sm text-fg pl-2 border-l-2 border-accent/30">
                          <span>{ach}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {exp.reasonForChange && exp.reasonForChange !== "Not applicable" && (
                  <p className="text-xs text-fg-muted">
                    <span className="font-medium">Reason for Change:</span> {exp.reasonForChange}
                  </p>
                )}
                {i < pastExperience.length - 1 && <div className="border-t border-outline/10 pt-3" />}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Technical & Soft Skills */}
      {(technicalSkills?.length > 0 || softSkills?.length > 0) && (
        <SectionCard title="Technical Assessment and Soft Skills">
          {technicalSkills?.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-widest text-fg-muted mb-3">Technical Skills</p>
              <div className="space-y-3">
                {technicalSkills.map((skill, i) => (
                  <SkillRow key={i} skill={skill} />
                ))}
              </div>
            </div>
          )}
          {softSkills?.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-fg-muted mb-3">Soft Skills</p>
              <div className="space-y-3">
                {softSkills.map((skill, i) => (
                  <SkillRow key={i} skill={skill} />
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Next Steps */}
      {nextSteps?.length > 0 && (
        <SectionCard title="Next Steps">
          <div className="space-y-3">
            {nextSteps.map((step, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-5 h-5 rounded border border-outline/30 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-fg">
                    <span className="font-medium">{step.action}</span>
                    <TimestampBadge ts={step.timestamp} />
                  </p>
                  <p className="text-xs text-fg-muted mt-0.5">
                    Owner: <span className="font-medium">{step.owner}</span> &middot; Timeline: {step.timeline}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="font-semibold text-fg flex-shrink-0">{label}:</span>
      <span className="text-fg-muted">{value}</span>
    </div>
  );
}

function SkillRow({ skill }: { skill: TechnicalSkill }) {
  const cfg = LEVEL_CONFIG[skill.level] ?? LEVEL_CONFIG.unknown;
  return (
    <div className="flex gap-2.5 items-start text-sm">
      <span className="text-base flex-shrink-0 mt-0.5">{cfg.emoji}</span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-fg">{skill.name}</span>
        {skill.timestamp && <TimestampBadge ts={skill.timestamp} />}
        <span className="text-fg-muted">: {skill.description}</span>
      </div>
    </div>
  );
}
