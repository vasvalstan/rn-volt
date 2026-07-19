import { MaterialIcons } from "@react-native-vector-icons/material-icons";
import { Image } from "expo-image";
import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  Platform,
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
import { ensureRecordingPermissionAsync } from "../lib/audioPermissions";

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

export type GuidedActivityCompletion = {
  note?: string;
  transcript?: string;
  summary?: string;
  voiceUri?: string;
};

type Props = {
  readonly activity: ActivityLike;
  readonly reward: Reward;
  readonly onClose: () => void;
  readonly onComplete: (completion?: GuidedActivityCompletion) => Promise<void>;
  readonly onSummarizeVoiceNote?: (args: {
    audioBase64: string;
    mimeType: string;
    typedNote?: string;
  }) => Promise<{
    transcript?: string;
    summary?: string;
    note?: string;
  }>;
};

type SessionMode = "timer" | "focusdot" | "self-report" | "tap";
const RECORDING_MIME_TYPE =
  Platform.OS === "web" ? "audio/webm" : "audio/mp4";

async function restorePlaybackAudioMode() {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
  });
}

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
  onSummarizeVoiceNote,
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
  const [summarizingVoice, setSummarizingVoice] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [voiceUri, setVoiceUri] = useState<string | undefined>();
  const [voiceSummary, setVoiceSummary] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef(0);
  const recordingActiveRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const isDone = remaining <= 0;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      const shouldStop = recordingActiveRef.current;
      recordingActiveRef.current = false;
      void (async () => {
        try {
          if (shouldStop) {
            await recorder.stop();
          }
        } catch {
          // The native recorder may already have been released during teardown.
        } finally {
          await restorePlaybackAudioMode().catch(() => {});
        }
      })();
    },
    [clearTimer, recorder],
  );

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

  const buildCompletion = useCallback(async (): Promise<GuidedActivityCompletion> => {
    const completion: GuidedActivityCompletion = {
      note: noteText.trim() || undefined,
      voiceUri,
      transcript: voiceTranscript.trim() || undefined,
      summary: voiceSummary.trim() || undefined,
    };

    if (voiceUri && onSummarizeVoiceNote && !completion.transcript && !completion.summary) {
      setSummarizingVoice(true);
      try {
        const audioBase64 = await FileSystem.readAsStringAsync(voiceUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const result = await onSummarizeVoiceNote({
          audioBase64,
          mimeType: RECORDING_MIME_TYPE,
          typedNote: completion.note,
        });
        completion.transcript = result.transcript?.trim() || undefined;
        completion.summary = result.summary?.trim() || undefined;
        completion.note = result.note?.trim() || completion.note;
        setVoiceTranscript(completion.transcript ?? "");
        setVoiceSummary(completion.summary ?? "");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Voice note summary failed.";
        setVoiceError(message);
      } finally {
        setSummarizingVoice(false);
      }
    }

    return completion;
  }, [noteText, voiceUri, voiceTranscript, voiceSummary, onSummarizeVoiceNote]);

  const handleComplete = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await onComplete(await buildCompletion());
    } finally {
      setCompleting(false);
    }
  }, [onComplete, completing, buildCompletion]);

  const handleTapComplete = useCallback(async () => {
    setStep("done");
    setCompleting(true);
    try {
      await onComplete(await buildCompletion());
    } finally {
      setCompleting(false);
    }
  }, [onComplete, buildCompletion]);

  const toggleRecording = useCallback(async () => {
    setVoiceError("");
    if (recorderState.isRecording || recordingActiveRef.current) {
      try {
        await recorder.stop();
        recordingActiveRef.current = false;
        setVoiceUri(recorder.uri ?? undefined);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not stop the voice note.";
        setVoiceError(message);
      } finally {
        await restorePlaybackAudioMode().catch(() => {});
      }
      return;
    }

    try {
      await ensureRecordingPermissionAsync();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingActiveRef.current = true;
    } catch (error) {
      recordingActiveRef.current = false;
      await restorePlaybackAudioMode().catch(() => {});
      const message = error instanceof Error ? error.message : "Microphone permission is needed for voice notes.";
      setVoiceError(message);
    }
  }, [recorder, recorderState.isRecording]);

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

  const showsInput = mode === "self-report";
  const showsVoiceNote = mode === "self-report";

  const rewardLine = `+${reward.minutes} min  +${reward.vp} VP`;

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
          {activity.key === "stretch" ? (
            <Image
              source={{ uri: "https://media.giphy.com/media/l41YkxvU8c7J7Bba0/giphy.gif" }}
              style={{ width: 160, height: 160, borderRadius: 20 }}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.bigIcon, { backgroundColor: activity.color }]}>
              <MaterialIcons name={activity.icon as any} size={48} color={C.white} />
            </View>
          )}
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
          {voiceSummary ? (
            <Text style={styles.voiceSummaryText}>{voiceSummary}</Text>
          ) : null}
        </View>
        <Pressable
          style={[styles.ctaBtn, completing && { opacity: 0.6 }]}
          onPress={handleComplete}
          disabled={completing || summarizingVoice}
        >
          <Text style={styles.ctaText}>
            {summarizingVoice ? "Summarizing..." : completing ? "Saving..." : "Claim Reward"}
          </Text>
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
            {activity.key === "stretch" && (
              <Image
                source={{ uri: "https://media.giphy.com/media/l41YkxvU8c7J7Bba0/giphy.gif" }}
                style={{ width: 160, height: 160, borderRadius: 20, marginBottom: 8 }}
                contentFit="cover"
              />
            )}
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
                  placeholder={
                    activity.key === "gratitude"
                      ? "I'm grateful for..."
                      : activity.key === "planday"
                        ? "My top priority today..."
                        : "Add a quick note..."
                  }
                  placeholderTextColor="#999"
                  multiline
                  value={noteText}
                  onChangeText={setNoteText}
                />
              )}
              {showsVoiceNote ? (
                <View style={styles.voicePanel}>
                  <Pressable
                    style={[
                      styles.voiceButton,
                      recorderState.isRecording && styles.voiceButtonActive,
                    ]}
                    onPress={() => {
                      void toggleRecording();
                    }}
                  >
                    <MaterialIcons
                      name={recorderState.isRecording ? "stop" : "mic"}
                      size={18}
                      color={C.white}
                    />
                    <Text style={styles.voiceButtonText}>
                      {recorderState.isRecording ? "Stop voice note" : voiceUri ? "Record again" : "Voice note"}
                    </Text>
                  </Pressable>
                  <Text style={styles.voiceHint}>
                    {recorderState.isRecording
                      ? `${Math.max(1, Math.round(recorderState.durationMillis / 1000))}s recording`
                      : voiceUri
                        ? "Voice note attached"
                        : "Talk instead of typing"}
                  </Text>
                  {voiceError ? <Text style={styles.voiceError}>{voiceError}</Text> : null}
                </View>
              ) : null}
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
  voicePanel: {
    width: "100%",
    alignItems: "center",
    gap: 6,
  },
  voiceButton: {
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: 16,
    backgroundColor: C.purple,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: C.black,
  },
  voiceButtonActive: {
    backgroundColor: C.hotPink,
  },
  voiceButtonText: {
    color: C.white,
    fontSize: 13,
    fontWeight: "900",
  },
  voiceHint: {
    color: C.mutedFg,
    fontSize: 12,
    fontWeight: "700",
  },
  voiceError: {
    color: C.hotPink,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
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
  voiceSummaryText: {
    maxWidth: 280,
    color: C.black,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
});
