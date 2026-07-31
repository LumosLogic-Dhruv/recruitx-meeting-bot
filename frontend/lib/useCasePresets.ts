/**
 * Client-side use case presets — mirrors convex/lib/useCasePresets.ts
 * Used by UI components for labels, colors, and display logic.
 */

export type UseCasePreset = {
  id: string;
  label: string;
  contactLabel: string;
  color: string;
  bg: string;
  recommendations: Record<string, { label: string; color: string }>;
};

export const USE_CASE_PRESETS: UseCasePreset[] = [
  {
    id: "recruiting",
    label: "Recruiting",
    contactLabel: "Candidate",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
    recommendations: {
      STRONG_HIRE: { label: "Strong Hire", color: "#22c55e" },
      HIRE: { label: "Hire", color: "#3b82f6" },
      MAYBE: { label: "Maybe", color: "#f59e0b" },
      NO_HIRE: { label: "No Hire", color: "#ef4444" },
    },
  },
  {
    id: "sales",
    label: "Sales",
    contactLabel: "Prospect",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.12)",
    recommendations: {
      STRONG_LEAD: { label: "Strong Lead", color: "#22c55e" },
      QUALIFIED: { label: "Qualified", color: "#3b82f6" },
      NURTURE: { label: "Nurture", color: "#f59e0b" },
      DISQUALIFIED: { label: "Disqualified", color: "#ef4444" },
    },
  },
  {
    id: "real_estate",
    label: "Real Estate",
    contactLabel: "Client",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
    recommendations: {
      HOT_LEAD: { label: "Hot Lead", color: "#22c55e" },
      WARM_LEAD: { label: "Warm Lead", color: "#3b82f6" },
      COLD_LEAD: { label: "Cold Lead", color: "#f59e0b" },
      NOT_READY: { label: "Not Ready", color: "#ef4444" },
    },
  },
  {
    id: "custom",
    label: "Custom",
    contactLabel: "Contact",
    color: "#737373",
    bg: "rgba(115,115,115,0.12)",
    recommendations: {
      STRONG_YES: { label: "Strong Yes", color: "#22c55e" },
      YES: { label: "Yes", color: "#3b82f6" },
      MAYBE: { label: "Maybe", color: "#f59e0b" },
      NO: { label: "No", color: "#ef4444" },
    },
  },
];

export function getPreset(useCase?: string): UseCasePreset {
  return (
    USE_CASE_PRESETS.find((p) => p.id === useCase) ??
    USE_CASE_PRESETS.find((p) => p.id === "custom")!
  );
}

export function getContactLabel(useCase?: string): string {
  return getPreset(useCase).contactLabel;
}

export function getRecommendationLabel(useCase?: string, recommendation?: string): { label: string; color: string } {
  const preset = getPreset(useCase);
  return (
    preset.recommendations[recommendation ?? ""] ?? { label: recommendation ?? "Unknown", color: "#737373" }
  );
}

/** Normalize legacy "recruiter" role to "member" */
export function normalizeRole(role: string): string {
  return role === "recruiter" ? "member" : role;
}
