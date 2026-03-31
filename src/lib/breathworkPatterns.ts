/**
 * Breathing patterns for guided Breathwork session (Unlock).
 * Durations are seconds per phase; inhale expands the circle, exhale contracts.
 */

export type BreathPhaseKind = "inhale" | "hold" | "exhale";

export type BreathPhase = { readonly kind: BreathPhaseKind; readonly sec: number };

export type BreathPatternId = "box" | "relax" | "coherent" | "balance" | "sigh";

export type BreathPatternDef = {
  readonly id: BreathPatternId;
  readonly title: string;
  readonly subtitle: string;
  readonly phases: readonly BreathPhase[];
};

export const BREATH_PATTERN_LIST: BreathPatternDef[] = [
  {
    id: "box",
    title: "Box breathing",
    subtitle: "4-4-4-4 — calm, steady focus (Navy / tactical style).",
    phases: [
      { kind: "inhale", sec: 4 },
      { kind: "hold", sec: 4 },
      { kind: "exhale", sec: 4 },
      { kind: "hold", sec: 4 },
    ],
  },
  {
    id: "relax",
    title: "4-6 relax",
    subtitle: "Longer exhale — gentle downshift for stress.",
    phases: [
      { kind: "inhale", sec: 4 },
      { kind: "exhale", sec: 6 },
    ],
  },
  {
    id: "coherent",
    title: "Coherent 5-5",
    subtitle: "Even in/out — easy rhythm to maintain.",
    phases: [
      { kind: "inhale", sec: 5 },
      { kind: "exhale", sec: 5 },
    ],
  },
  {
    id: "balance",
    title: "Balanced 4-4",
    subtitle: "Quick reset between tasks or scroll breaks.",
    phases: [
      { kind: "inhale", sec: 4 },
      { kind: "exhale", sec: 4 },
    ],
  },
  {
    id: "sigh",
    title: "Physiological sigh",
    subtitle: "Double inhale + long exhale — fast tension release.",
    phases: [
      { kind: "inhale", sec: 2 },
      { kind: "exhale", sec: 6 },
    ],
  },
];

export const BREATH_PATTERN_MAP: Record<BreathPatternId, BreathPatternDef> = Object.fromEntries(
  BREATH_PATTERN_LIST.map((p) => [p.id, p]),
) as Record<BreathPatternId, BreathPatternDef>;

export function phaseLabel(kind: BreathPhaseKind): string {
  if (kind === "inhale") return "Breathe in";
  if (kind === "exhale") return "Breathe out";
  return "Hold";
}
