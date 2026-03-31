import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  BREATH_PATTERN_LIST,
  type BreathPatternDef,
  type BreathPatternId,
  type BreathPhase,
  phaseLabel,
} from "../lib/breathworkPatterns";

const C = {
  black: "#1A1A1A",
  white: "#FFFFFF",
  cream: "#FFFCEB",
  hotPink: "#FF2D78",
  mint: "#00E5A0",
  purple: "#8B5CF6",
  purpleLight: "#F1EBFE",
  mutedFg: "#666666",
  electricYellow: "#FFD60A",
};

const SH4 = {
  shadowColor: "#1A1A1A",
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 4,
};

export type BreathDurationMin = 1 | 2 | 3;

const DURATION_OPTIONS: BreathDurationMin[] = [1, 2, 3];

/** Base activity rewards scale by chosen session length (full = 3 min). */
export function breathRewardsForDuration(
  durationMin: BreathDurationMin,
  baseDp: number,
  baseMinutes: number,
  diffMultiplier: number,
): { dp: number; minutes: number } {
  const ratio = durationMin / 3;
  return {
    dp: Math.max(1, Math.round(baseDp * ratio * diffMultiplier)),
    minutes: Math.max(1, Math.round(baseMinutes * ratio * diffMultiplier)),
  };
}

type Step = "pick" | "run" | "done";

type Props = {
  readonly baseDp: number;
  readonly baseMinutes: number;
  readonly diffMultiplier: number;
  readonly onClose: () => void;
  readonly onComplete: (args: {
    durationMin: BreathDurationMin;
    patternId: BreathPatternId;
    dp: number;
    minutes: number;
  }) => Promise<void>;
};

function runPhaseAnimation(scale: SharedValue<number>, p: BreathPhase) {
  const ms = p.sec * 1000;
  if (p.kind === "inhale") {
    scale.value = 0.86;
    scale.value = withTiming(1.14, { duration: ms, easing: Easing.inOut(Easing.sin) });
  } else if (p.kind === "exhale") {
    scale.value = 1.14;
    scale.value = withTiming(0.86, { duration: ms, easing: Easing.inOut(Easing.sin) });
  }
  // "hold": keep scale; phase length is still enforced by outer setTimeout.
}

export default function BreathworkSession({
  baseDp,
  baseMinutes,
  diffMultiplier,
  onClose,
  onComplete,
}: Props) {
  const { width } = useWindowDimensions();
  const circleSize = Math.min(220, width * 0.52);

  const [step, setStep] = useState<Step>("pick");
  const [patternId, setPatternId] = useState<BreathPatternId>("box");
  const [durationMin, setDurationMin] = useState<BreathDurationMin>(2);

  const pattern = useMemo(
    () => BREATH_PATTERN_LIST.find((p) => p.id === patternId) ?? BREATH_PATTERN_LIST[0],
    [patternId],
  );

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [remainingSessionSec, setRemainingSessionSec] = useState(0);
  const phaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionEndRef = useRef(0);
  const phaseIndexRef = useRef(0);

  const scale = useSharedValue(1);
  const celebrate = useSharedValue(0);

  const clearPhaseTimeout = useCallback(() => {
    if (phaseTimeoutRef.current !== null) {
      clearTimeout(phaseTimeoutRef.current);
      phaseTimeoutRef.current = null;
    }
  }, []);

  const finishSession = useCallback(() => {
    clearPhaseTimeout();
    setStep("done");
    celebrate.value = 0;
    celebrate.value = withSequence(
      withTiming(1, { duration: 280, easing: Easing.out(Easing.back(1.8)) }),
      withTiming(0.92, { duration: 200 }),
      withTiming(1, { duration: 220 }),
    );
  }, [clearPhaseTimeout, celebrate]);

  const scheduleNextPhase = useCallback(
    (p: BreathPatternDef, sessionEnd: number) => {
      const tick = () => {
        const now = Date.now();
        if (now >= sessionEnd) {
          finishSession();
          return;
        }
        const phases = p.phases;
        const i = phaseIndexRef.current;
        const ph = phases[i % phases.length];
        if (!ph) {
          finishSession();
          return;
        }
        setPhaseIndex(i % phases.length);
        runPhaseAnimation(scale, ph);
        const delayMs = ph.sec * 1000;
        phaseIndexRef.current = i + 1;
        phaseTimeoutRef.current = setTimeout(() => {
          phaseTimeoutRef.current = null;
          setRemainingSessionSec(Math.max(0, Math.ceil((sessionEnd - Date.now()) / 1000)));
          tick();
        }, delayMs);
      };
      tick();
    },
    [scale, finishSession],
  );

  useEffect(() => () => clearPhaseTimeout(), [clearPhaseTimeout]);

  const startSession = useCallback(() => {
    const p = BREATH_PATTERN_LIST.find((x) => x.id === patternId) ?? BREATH_PATTERN_LIST[0];
    sessionEndRef.current = Date.now() + durationMin * 60 * 1000;
    setRemainingSessionSec(durationMin * 60);
    phaseIndexRef.current = 0;
    setPhaseIndex(0);
    setStep("run");
    clearPhaseTimeout();
    scale.value = 1;
    scheduleNextPhase(p, sessionEndRef.current);
  }, [patternId, durationMin, clearPhaseTimeout, scheduleNextPhase, scale]);

  useEffect(() => {
    if (step !== "run") return;
    const id = setInterval(() => {
      setRemainingSessionSec(Math.max(0, Math.ceil((sessionEndRef.current - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(id);
  }, [step]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const donePopStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + celebrate.value * 0.12 }],
  }));

  const currentPhase = pattern.phases[phaseIndex] ?? pattern.phases[0];

  const rewardsPreview = useMemo(
    () => breathRewardsForDuration(durationMin, baseDp, baseMinutes, diffMultiplier),
    [durationMin, baseDp, baseMinutes, diffMultiplier],
  );

  const formatClock = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleFinish = useCallback(async () => {
    const { dp, minutes } = breathRewardsForDuration(durationMin, baseDp, baseMinutes, diffMultiplier);
    await onComplete({ durationMin, patternId, dp, minutes });
  }, [durationMin, patternId, baseDp, baseMinutes, diffMultiplier, onComplete]);

  return (
    <View style={styles.overlay}>
      <View style={[styles.sheet, { paddingTop: 12 }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
            <MaterialIcons name="close" size={24} color={C.black} />
          </Pressable>
          <Text style={styles.title}>Breathwork</Text>
          <View style={{ width: 44 }} />
        </View>

        {step === "pick" ? (
          <View style={styles.pickColumn}>
            <Text style={styles.sectionLabel}>Pattern</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.patternChipRow}
            >
              {BREATH_PATTERN_LIST.map((p) => {
                const active = p.id === patternId;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setPatternId(p.id)}
                    style={[styles.patternChip, active && styles.patternChipActive]}
                  >
                    <Text style={[styles.patternChipText, active && styles.patternChipTextActive]} numberOfLines={2}>
                      {p.title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.patternSelectedHint} numberOfLines={2}>
              {pattern.subtitle}
            </Text>

            <Text style={[styles.sectionLabel, styles.sectionLabelTight]}>Session length</Text>
            <View style={styles.durationRow}>
              {DURATION_OPTIONS.map((d) => {
                const active = d === durationMin;
                const r = breathRewardsForDuration(d, baseDp, baseMinutes, diffMultiplier);
                return (
                  <Pressable
                    key={d}
                    onPress={() => setDurationMin(d)}
                    style={[styles.durationChip, active && styles.durationChipActive]}
                  >
                    <Text style={[styles.durationChipText, active && styles.durationChipTextActive]}>{d} min</Text>
                    <Text style={[styles.durationReward, active && styles.durationRewardActive]}>
                      +{r.minutes} min · {r.dp} DP
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable style={styles.startBtn} onPress={startSession}>
              <Text style={styles.startBtnText}>Start session</Text>
            </Pressable>
          </View>
        ) : null}

        {step === "run" && currentPhase ? (
          <View style={styles.runBody}>
            <Text style={styles.timerBig}>{formatClock(remainingSessionSec)}</Text>
            <Text style={styles.phaseLabel}>{phaseLabel(currentPhase.kind)}</Text>
            <Animated.View
              style={[
                styles.circleOuter,
                { width: circleSize, height: circleSize, borderRadius: circleSize / 2 },
                circleStyle,
              ]}
            >
              <View
                style={[
                  styles.circleInner,
                  { width: circleSize - 28, height: circleSize - 28, borderRadius: (circleSize - 28) / 2 },
                ]}
              >
                <MaterialIcons name="spa" size={42} color={C.white} />
              </View>
            </Animated.View>
            <Text style={styles.runHint}>Follow the circle — in expands, out contracts.</Text>
          </View>
        ) : null}

        {step === "done" ? (
          <View style={styles.doneBody}>
            <Animated.View style={[styles.doneIconWrap, donePopStyle]}>
              <MaterialIcons name="verified" size={48} color={C.mint} />
            </Animated.View>
            <Text style={styles.doneTitle}>Session complete</Text>
            <Text style={styles.doneSub}>
              You finished {durationMin} min of {pattern.title.toLowerCase()}.
            </Text>
            <View style={styles.rewardRow}>
              <View style={styles.rewardPill}>
                <MaterialIcons name="battery-charging-full" size={18} color={C.black} />
                <Text style={styles.rewardPillText}>+{rewardsPreview.minutes} min fuel</Text>
              </View>
              <View style={styles.rewardPill}>
                <MaterialIcons name="paid" size={18} color={C.black} />
                <Text style={styles.rewardPillText}>+{rewardsPreview.dp} DP</Text>
              </View>
            </View>
            <Pressable
              style={styles.doneBtn}
              onPress={() => {
                void handleFinish();
              }}
            >
              <Text style={styles.doneBtnText}>Claim & continue</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(26,26,26,0.45)",
    zIndex: 200,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.cream,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 2,
    borderColor: C.black,
    maxHeight: "92%",
    paddingBottom: 28,
    ...SH4,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.white,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: C.black,
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
    fontStyle: "italic",
    textTransform: "uppercase",
    color: C.black,
  },
  pickColumn: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: C.hotPink,
    marginBottom: 6,
  },
  sectionLabelTight: { marginTop: 10 },
  patternChipRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 4,
    paddingBottom: 2,
  },
  patternChip: {
    maxWidth: 118,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    ...SH4,
  },
  patternChipActive: { backgroundColor: C.purpleLight },
  patternChipText: {
    fontSize: 10,
    fontWeight: "900",
    color: C.black,
    textTransform: "uppercase",
    lineHeight: 13,
  },
  patternChipTextActive: { color: C.black },
  patternSelectedHint: {
    fontSize: 10,
    fontWeight: "700",
    color: C.mutedFg,
    lineHeight: 14,
    marginTop: 6,
    marginBottom: 2,
  },
  durationRow: { flexDirection: "row", gap: 8 },
  durationChip: {
    flex: 1,
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 12,
    paddingVertical: 7,
    alignItems: "center",
    ...SH4,
  },
  durationChipActive: { backgroundColor: C.hotPink },
  durationChipText: { fontSize: 11, fontWeight: "900", color: C.black },
  durationChipTextActive: { color: C.white },
  durationReward: { fontSize: 8, fontWeight: "700", color: C.mutedFg, marginTop: 2 },
  durationRewardActive: { color: "rgba(255,255,255,0.9)" },
  startBtn: {
    marginTop: 14,
    backgroundColor: C.mint,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: "center",
    ...SH4,
  },
  startBtnText: { fontSize: 13, fontWeight: "900", textTransform: "uppercase", color: C.black },
  runBody: { alignItems: "center", paddingVertical: 12, paddingHorizontal: 20 },
  timerBig: {
    fontSize: 36,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    color: C.black,
    marginBottom: 4,
  },
  phaseLabel: {
    fontSize: 14,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: C.purple,
    marginBottom: 20,
  },
  circleOuter: {
    backgroundColor: C.hotPink,
    borderWidth: 3,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH4,
  },
  circleInner: {
    backgroundColor: "rgba(0,0,0,0.15)",
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
  },
  runHint: {
    marginTop: 20,
    fontSize: 11,
    fontWeight: "700",
    color: C.mutedFg,
    textAlign: "center",
  },
  doneBody: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8 },
  doneIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.white,
    borderWidth: 3,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    ...SH4,
  },
  doneTitle: { fontSize: 22, fontWeight: "900", fontStyle: "italic", textTransform: "uppercase", color: C.black },
  doneSub: { fontSize: 13, fontWeight: "700", color: C.mutedFg, textAlign: "center", marginTop: 8, lineHeight: 19 },
  rewardRow: { flexDirection: "row", gap: 10, marginTop: 20, flexWrap: "wrap", justifyContent: "center" },
  rewardPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...SH4,
  },
  rewardPillText: { fontSize: 12, fontWeight: "900", color: C.black },
  doneBtn: {
    marginTop: 24,
    backgroundColor: C.electricYellow,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 32,
    ...SH4,
  },
  doneBtnText: { fontSize: 13, fontWeight: "900", textTransform: "uppercase", color: C.black },
});
