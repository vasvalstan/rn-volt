import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  black: "#1A1A1A",
  white: "#FFFFFF",
  hotPink: "#FF2D78",
  mint: "#00E5A0",
  purple: "#8B5CF6",
  mutedFg: "#666666",
  muted: "#E5E5E5",
  electricYellow: "#FFD60A",
  coinDarkYellow: "#A67C00",
};

type ActivityLike = {
  key: string;
  icon: string;
  name: string;
  effortLabel: string;
  color: string;
  bg: string;
  verificationMethod: string;
  instructions: string;
  effortDurationSec: number;
};

type Reward = { minutes: number; vp: number; coins: number };

type Props = {
  readonly activity: ActivityLike;
  readonly reward: Reward;
  readonly onClose: () => void;
  readonly onComplete: () => Promise<void>;
};

type SessionMode = "timer" | "focusdot" | "self-report" | "tap";

function resolveMode(method: string, key: string): SessionMode {
  if (key === "focusdot") return "focusdot";
  if (method === "tap") return "tap";
  if (method === "timer") return "timer";
  return "self-report";
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function GuidedActivitySession({
  activity,
  reward,
  onClose,
  onComplete,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const mode = resolveMode(activity.verificationMethod, activity.key);
  const durationSec = activity.effortDurationSec;

  const [step, setStep] = useState<"intro" | "run" | "done">(
    mode === "tap" ? "run" : "intro",
  );
  const [remaining, setRemaining] = useState(durationSec);
  const [completing, setCompleting] = useState(false);
  const [noteText, setNoteText] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef(0);

  const isDone = remaining <= 0;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const startTimer = useCallback(() => {
    clearTimer();
    const end = Date.now() + durationSec * 1000;
    endTimeRef.current = end;
    setRemaining(durationSec);
    setStep("run");
    intervalRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearTimer();
        setStep("done");
      }
    }, 250);
  }, [durationSec, clearTimer]);

  const handleComplete = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  }, [onComplete, completing]);

  const handleTapComplete = useCallback(async () => {
    setStep("done");
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  }, [onComplete]);

  const ringSize = Math.min(200, width * 0.48);
  const strokeW = 8;
  const radius = (ringSize - strokeW) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = durationSec > 0 ? 1 - remaining / durationSec : 1;

  // Focus dot animation
  const dotX = useSharedValue(0);
  const dotY = useSharedValue(0);
  const dotScale = useSharedValue(1);

  useEffect(() => {
    if (mode === "focusdot" && step === "run") {
      dotScale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
      dotX.value = withRepeat(
        withSequence(
          withTiming(20, { duration: 3500, easing: Easing.inOut(Easing.sin) }),
          withTiming(-20, { duration: 3500, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
      dotY.value = withRepeat(
        withSequence(
          withTiming(15, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
          withTiming(-15, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
    }
  }, [mode, step, dotScale, dotX, dotY]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dotX.value },
      { translateY: dotY.value },
      { scale: dotScale.value },
    ],
  }));

  // Done celebration
  const celebScale = useSharedValue(1);
  useEffect(() => {
    if (step === "done") {
      celebScale.value = withSequence(
        withTiming(1.15, { duration: 200, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 180 }),
      );
    }
  }, [step, celebScale]);

  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebScale.value }],
  }));

  const showsInput = mode === "self-report" &&
    (activity.key === "gratitude" || activity.key === "planday");

  const rewardLine = `+${reward.minutes} min  +${reward.vp} VP  +${reward.coins} coins`;

  // ─── TAP MODE ────────────────────────────────────
  if (mode === "tap") {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={24} color={C.black} />
          </Pressable>
        </View>
        <View style={styles.centerCol}>
          <View style={[styles.bigIcon, { backgroundColor: activity.color }]}>
            <MaterialIcons name={activity.icon as any} size={48} color={C.white} />
          </View>
          <Text style={styles.title}>{activity.name}</Text>
          <Text style={styles.instructions}>{activity.instructions}</Text>
          <Text style={styles.rewardPreview}>{rewardLine}</Text>
        </View>
        <Pressable
          style={[styles.ctaBtn, completing && { opacity: 0.6 }]}
          onPress={handleTapComplete}
          disabled={completing}
        >
          <Text style={styles.ctaText}>{completing ? "Logging..." : "Log it"}</Text>
        </Pressable>
      </View>
    );
  }

  // ─── INTRO SCREEN ────────────────────────────────
  if (step === "intro") {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={24} color={C.black} />
          </Pressable>
        </View>
        <View style={styles.centerCol}>
          <View style={[styles.bigIcon, { backgroundColor: activity.color }]}>
            <MaterialIcons name={activity.icon as any} size={48} color={C.white} />
          </View>
          <Text style={styles.title}>{activity.name}</Text>
          <Text style={styles.instructions}>{activity.instructions}</Text>
          <View style={styles.durationChip}>
            <MaterialIcons name="timer" size={16} color={C.mutedFg} />
            <Text style={styles.durationChipText}>{formatClock(durationSec)}</Text>
          </View>
          <Text style={styles.rewardPreview}>{rewardLine}</Text>
        </View>
        <Pressable style={styles.ctaBtn} onPress={startTimer}>
          <Text style={styles.ctaText}>Start</Text>
        </Pressable>
      </View>
    );
  }

  // ─── DONE SCREEN ────────────────────────────────
  if (step === "done") {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={24} color={C.black} />
          </Pressable>
        </View>
        <View style={styles.centerCol}>
          <Animated.View style={celebStyle}>
            <View style={styles.doneCircle}>
              <MaterialIcons name="check" size={56} color={C.white} />
            </View>
          </Animated.View>
          <Text style={styles.doneTitle}>Nice work!</Text>
          <Text style={styles.doneReward}>{rewardLine}</Text>
        </View>
        <Pressable
          style={[styles.ctaBtn, completing && { opacity: 0.6 }]}
          onPress={handleComplete}
          disabled={completing}
        >
          <Text style={styles.ctaText}>{completing ? "Saving..." : "Claim Reward"}</Text>
        </Pressable>
      </View>
    );
  }

  // ─── RUNNING SESSION ────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.topBar}>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <MaterialIcons name="close" size={24} color={C.black} />
        </Pressable>
        <Text style={styles.topBarTitle}>{activity.name}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.centerCol}>
        {mode === "focusdot" ? (
          <>
            <Text style={styles.focusHint}>Keep your eyes on the dot</Text>
            <View style={styles.focusDotArea}>
              <Animated.View style={[styles.focusDot, { backgroundColor: activity.color }, dotStyle]} />
            </View>
            <Text style={styles.timerText}>{formatClock(remaining)}</Text>
          </>
        ) : mode === "timer" ? (
          <>
            <View style={{ width: ringSize, height: ringSize, alignItems: "center", justifyContent: "center" }}>
              <Svg width={ringSize} height={ringSize} style={StyleSheet.absoluteFill}>
                <SvgCircle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  stroke={C.muted}
                  strokeWidth={strokeW}
                  fill="none"
                />
                <SvgCircle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  stroke={activity.color}
                  strokeWidth={strokeW}
                  fill="none"
                  strokeDasharray={`${circumference}`}
                  strokeDashoffset={circumference * (1 - progress)}
                  strokeLinecap="round"
                  rotation={-90}
                  origin={`${ringSize / 2}, ${ringSize / 2}`}
                />
              </Svg>
              <Text style={styles.ringTime}>{formatClock(remaining)}</Text>
            </View>
            <Text style={styles.timerInstruction}>{activity.instructions}</Text>
          </>
        ) : (
          <>
            <View style={styles.selfReportCard}>
              <MaterialIcons name={activity.icon as any} size={32} color={activity.color} />
              <Text style={styles.selfReportInstr}>{activity.instructions}</Text>
              {showsInput && (
                <TextInput
                  style={styles.noteInput}
                  placeholder={activity.key === "gratitude" ? "I'm grateful for..." : "My top priority today..."}
                  placeholderTextColor="#999"
                  multiline
                  value={noteText}
                  onChangeText={setNoteText}
                />
              )}
            </View>
            <View style={styles.selfReportTimerRow}>
              <MaterialIcons name="timer" size={16} color={isDone ? C.mint : C.mutedFg} />
              <Text style={[styles.selfReportTimerText, isDone && { color: C.mint }]}>
                {isDone ? "Ready!" : formatClock(remaining)}
              </Text>
            </View>
          </>
        )}
      </View>

      {mode === "self-report" ? (
        <Pressable
          style={[styles.ctaBtn, !isDone && styles.ctaBtnDisabled]}
          onPress={() => {
            clearTimer();
            setStep("done");
          }}
          disabled={!isDone}
        >
          <Text style={styles.ctaText}>
            {isDone ? "I've done this" : `Wait ${formatClock(remaining)}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const SH = {
  shadowColor: "#1A1A1A",
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.white,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F0F0F0",
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: C.black,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  centerCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  bigIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: C.black,
    textAlign: "center",
  },
  instructions: {
    fontSize: 15,
    fontWeight: "600",
    color: C.mutedFg,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  durationChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0F0F0",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  durationChipText: {
    fontSize: 15,
    fontWeight: "800",
    color: C.black,
  },
  rewardPreview: {
    fontSize: 13,
    fontWeight: "700",
    color: C.mutedFg,
    marginTop: 4,
  },
  ctaBtn: {
    height: 56,
    borderRadius: 9999,
    backgroundColor: C.hotPink,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    ...SH,
  },
  ctaBtnDisabled: {
    backgroundColor: C.muted,
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "900",
    color: C.black,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  // Timer ring
  ringTime: {
    fontSize: 42,
    fontWeight: "900",
    color: C.black,
  },
  timerText: {
    fontSize: 32,
    fontWeight: "900",
    color: C.black,
    marginTop: 8,
  },
  timerInstruction: {
    fontSize: 14,
    fontWeight: "600",
    color: C.mutedFg,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  // Focus dot
  focusHint: {
    fontSize: 14,
    fontWeight: "700",
    color: C.mutedFg,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  focusDotArea: {
    width: 180,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  focusDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: C.black,
  },
  // Self report
  selfReportCard: {
    width: "100%",
    backgroundColor: "#F8F8F6",
    borderRadius: 20,
    borderWidth: 2,
    borderColor: C.black,
    padding: 20,
    alignItems: "center",
    gap: 12,
    ...SH,
  },
  selfReportInstr: {
    fontSize: 15,
    fontWeight: "600",
    color: C.black,
    textAlign: "center",
    lineHeight: 22,
  },
  noteInput: {
    width: "100%",
    minHeight: 72,
    borderWidth: 1.5,
    borderColor: C.muted,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    fontWeight: "600",
    color: C.black,
    textAlignVertical: "top",
  },
  selfReportTimerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  selfReportTimerText: {
    fontSize: 16,
    fontWeight: "800",
    color: C.mutedFg,
  },
  // Done
  doneCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: C.mint,
    borderWidth: 3,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH,
  },
  doneTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: C.black,
  },
  doneReward: {
    fontSize: 15,
    fontWeight: "700",
    color: C.mutedFg,
  },
});
