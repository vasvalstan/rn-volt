import { MaterialIcons } from "@react-native-vector-icons/material-icons";
import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ensureRecordingPermissionAsync } from "../lib/audioPermissions";
import {
  startRealtimeCoachSession,
  type RealtimeCoachSessionHandle,
  type RealtimeCreateCallResult,
  type RealtimeUsage,
  type RealtimeVoiceEndReason,
  type RealtimeVoiceStatus,
} from "../lib/openaiRealtimeWebrtc";

const C = {
  black: "#1A1A1A",
  white: "#FFFFFF",
  hotPink: "#FF2D78",
  mint: "#00E5A0",
  mutedFg: "#666666",
  muted: "#E5E5E5",
  soft: "#F6F4EF",
  yellow: "#FFD60A",
  red: "#FF4D4F",
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

export type CoachTurn = {
  role: "assistant" | "user";
  text: string;
  at: number;
};

export type CoachTrigger = {
  type: string;
  minutesSpent?: number;
  reason?: string;
};

export type ReflectiveCoachCompletion = {
  note?: string;
  transcript?: string;
  summary?: string;
  coachSessionId?: string;
};

type ContinueResult = {
  userTranscript?: string;
  assistantText?: string;
  shouldComplete?: boolean;
  summary?: string;
  note?: string;
};

type SummaryResult = {
  transcript?: string;
  summary?: string;
  note?: string;
};

const RECORDING_MIME_TYPE =
  Platform.OS === "web" ? "audio/webm" : "audio/mp4";

async function restorePlaybackAudioMode() {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
  });
}

type Props = {
  readonly activity: ActivityLike;
  readonly reward: Reward;
  readonly trigger?: CoachTrigger;
  readonly voiceMode?: "turn" | "realtime";
  readonly onClose: () => void;
  readonly onComplete: (completion?: ReflectiveCoachCompletion) => Promise<void>;
  readonly onContinue: (args: {
    turns: CoachTurn[];
    audioBase64?: string;
    mimeType?: string;
    typedText?: string;
    trigger?: CoachTrigger;
  }) => Promise<ContinueResult>;
  readonly onSummarize: (args: {
    turns: CoachTurn[];
    trigger?: CoachTrigger;
  }) => Promise<SummaryResult>;
  readonly onCreateRealtimeCall?: (args: {
    offerSdp: string;
    trigger?: CoachTrigger;
  }) => Promise<RealtimeCreateCallResult>;
  readonly onEndRealtimeCall?: (args: {
    sessionId: RealtimeCreateCallResult["sessionId"];
    reason: RealtimeVoiceEndReason;
  }) => Promise<unknown>;
  readonly onRecordRealtimeUsage?: (args: {
    sessionId: RealtimeCreateCallResult["sessionId"];
    responseId: string;
    usage: RealtimeUsage;
  }) => Promise<unknown>;
  readonly onSaveSession: (args: {
    turns: CoachTurn[];
    transcript?: string;
    summary?: string;
    note?: string;
    trigger?: CoachTrigger;
    startedAt: number;
    completedAt: number;
    durationSec: number;
  }) => Promise<string>;
};

function initialPrompt(activity: ActivityLike, trigger?: CoachTrigger): string {
  if (trigger?.type === "fast_fuel_spend") {
    const minutes = trigger.minutesSpent ? `${trigger.minutesSpent} minutes` : "some";
    return `Hey, you just used ${minutes} of scroll fuel. Let's pause for a moment. What were you looking for when you opened social media?`;
  }

  const prompts: Record<string, string> = {
    gratitude: "Hey, take a breath. What are you feeling grateful for today?",
    kindact: "Tell me about the kind act you did, or the one you are about to do.",
    mindfulwalk: "Before you finish, what did you notice on your walk that you normally miss?",
    planday: "What's the single most important thing you want to accomplish today?",
    phonebed: "What will help you put the phone away tonight and actually wind down?",
    clean: "What space did you clean, and how does it feel now?",
    instrument: "What did you practice, and what sounded a little better today?",
    study: "What did you study, and what is the next tiny step?",
    read: "What did you read, and what idea do you want to remember?",
    cookmeal: "What did you prepare, and how did you take care of yourself with it?",
    grayscale: "How did grayscale change the urge to scroll?",
  };
  return prompts[activity.key] ?? `Let's reflect on ${activity.name}. What did you do, and how did it feel?`;
}

function formatDuration(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  return `${sec}s`;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function normalizedText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameTextish(left: string, right: string): boolean {
  const a = normalizedText(left);
  const b = normalizedText(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function realtimeHint(status: RealtimeVoiceStatus, live: boolean): string {
  if (status === "connecting") return "Connecting to our latest voice model...";
  if (status === "listening") return "Listening live. Speak naturally, then pause.";
  if (status === "thinking") return "Volt is thinking through the live audio.";
  if (status === "speaking") return "Volt is speaking through our latest voice model.";
  if (status === "error") return "Live voice hit an error. Tap the mic to retry.";
  if (live) return "Our latest voice model is live. Tap stop to disconnect.";
  return "Tap the mic to start our latest voice model.";
}

export default function ReflectiveCoachSession({
  activity,
  reward,
  trigger,
  voiceMode = "turn",
  onClose,
  onComplete,
  onContinue,
  onSummarize,
  onCreateRealtimeCall,
  onEndRealtimeCall,
  onRecordRealtimeUsage,
  onSaveSession,
}: Props) {
  const insets = useSafeAreaInsets();
  const firstPrompt = useMemo(() => initialPrompt(activity, trigger), [activity, trigger]);
  const [turns, setTurns] = useState<CoachTurn[]>(() => [
    {
      role: "assistant",
      text: firstPrompt,
      at: Date.now(),
    },
  ]);
  const [typedText, setTypedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const [canComplete, setCanComplete] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeVoiceStatus>("idle");
  const [realtimeLive, setRealtimeLive] = useState(false);
  const [realtimeExpiresAt, setRealtimeExpiresAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [startedAt] = useState(() => Date.now());
  const scrollRef = useRef<ScrollView>(null);
  const turnsRef = useRef<CoachTurn[]>(turns);
  const realtimeSessionRef = useRef<RealtimeCoachSessionHandle | null>(null);
  const realtimeConnectSeqRef = useRef(0);
  const realtimeMountedRef = useRef(true);
  const spokenUserTurnsRef = useRef(0);
  const recordingActiveRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const realtimeEnabled =
    voiceMode === "realtime" &&
    Boolean(
      onCreateRealtimeCall &&
        onEndRealtimeCall &&
        onRecordRealtimeUsage,
    );

  const speak = useCallback((text: string) => {
    void Speech.stop();
    Speech.speak(text, {
      rate: 0.98,
      pitch: 1,
      language: "en-US",
    });
  }, []);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    if (realtimeEnabled) {
      void Speech.stop();
    } else {
      speak(firstPrompt);
    }
    return () => {
      void Speech.stop();
    };
  }, [firstPrompt, realtimeEnabled, speak]);

  useEffect(() => {
    realtimeMountedRef.current = true;
    return () => {
      realtimeMountedRef.current = false;
      realtimeConnectSeqRef.current += 1;
      realtimeSessionRef.current?.stop("user");
      realtimeSessionRef.current = null;
      const shouldStopRecording = recordingActiveRef.current;
      recordingActiveRef.current = false;
      void (async () => {
        try {
          if (shouldStopRecording) {
            await recorder.stop();
          }
        } catch {
          // The native recorder may already have been released during teardown.
        } finally {
          await restorePlaybackAudioMode().catch(() => {});
        }
      })();
      void Speech.stop();
    };
  }, [recorder]);

  useEffect(() => {
    if (!realtimeExpiresAt || !realtimeLive) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [realtimeExpiresAt, realtimeLive]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [turns.length, busy]);

  const appendRealtimeTurn = useCallback((role: CoachTurn["role"], text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;

    setTurns((currentTurns) => {
      const duplicate = currentTurns.some((turn) => turn.role === role && sameTextish(turn.text, cleanText));
      if (duplicate) return currentTurns;
      const nextTurns = [...currentTurns, { role, text: cleanText, at: Date.now() }];
      turnsRef.current = nextTurns;
      return nextTurns;
    });

    if (role === "user") {
      spokenUserTurnsRef.current += 1;
      setCanComplete(true);
    }
  }, []);

  const markRealtimeUserSpeech = useCallback(() => {
    spokenUserTurnsRef.current += 1;
    if (spokenUserTurnsRef.current > 0) {
      setCanComplete(true);
    }
  }, []);

  const updateRealtimeStatus = useCallback((status: RealtimeVoiceStatus) => {
    setRealtimeStatus(status);
    if (status === "closed" || status === "error" || status === "idle") {
      setRealtimeLive(false);
    } else if (status !== "connecting") {
      setRealtimeLive(true);
    }
  }, []);

  const stopRealtime = useCallback((reason: RealtimeVoiceEndReason = "user") => {
    realtimeConnectSeqRef.current += 1;
    realtimeSessionRef.current?.stop(reason);
    realtimeSessionRef.current = null;
    setRealtimeExpiresAt(null);
    setRealtimeLive(false);
    setRealtimeStatus("idle");
    setBusy(false);
  }, []);

  const startRealtime = useCallback(
    async (speakOpeningPrompt: boolean) => {
      if (
        !realtimeEnabled ||
        !onCreateRealtimeCall ||
        !onEndRealtimeCall ||
        !onRecordRealtimeUsage
      ) {
        return false;
      }
      if (realtimeSessionRef.current) return true;
      const connectSeq = realtimeConnectSeqRef.current + 1;
      realtimeConnectSeqRef.current = connectSeq;

      setBusy(true);
      setError("");
      updateRealtimeStatus("connecting");
      try {
        const session = await startRealtimeCoachSession({
          openingPrompt: speakOpeningPrompt ? firstPrompt : undefined,
          createCall: ({ offerSdp }) => onCreateRealtimeCall({ offerSdp, trigger }),
          endCall: onEndRealtimeCall,
          recordUsage: onRecordRealtimeUsage,
          onStatus: (status) => {
            if (
              !realtimeMountedRef.current ||
              realtimeConnectSeqRef.current !== connectSeq
            ) {
              return;
            }
            updateRealtimeStatus(status);
          },
          onUserSpeech: () => {
            if (
              realtimeMountedRef.current &&
              realtimeConnectSeqRef.current === connectSeq
            ) {
              markRealtimeUserSpeech();
            }
          },
          onUserTranscript: (text) => {
            if (
              realtimeMountedRef.current &&
              realtimeConnectSeqRef.current === connectSeq
            ) {
              appendRealtimeTurn("user", text);
            }
          },
          onAssistantTranscript: (text) => {
            if (
              realtimeMountedRef.current &&
              realtimeConnectSeqRef.current === connectSeq
            ) {
              appendRealtimeTurn("assistant", text);
            }
          },
          onEnded: (reason) => {
            if (
              !realtimeMountedRef.current ||
              realtimeConnectSeqRef.current !== connectSeq
            ) {
              return;
            }
            realtimeConnectSeqRef.current += 1;
            realtimeSessionRef.current = null;
            setBusy(false);
            setRealtimeExpiresAt(null);
            setRealtimeLive(false);
            setRealtimeStatus("idle");
            if (reason === "client_idle") {
              setError("Voice disconnected after 60 seconds without conversation.");
            } else if (reason === "client_limit") {
              setError("This live voice session reached its 5-minute limit.");
            }
          },
          onError: (realtimeError) => {
            if (
              !realtimeMountedRef.current ||
              realtimeConnectSeqRef.current !== connectSeq
            ) {
              return;
            }
            const message =
              realtimeError instanceof Error ? realtimeError.message : "Live voice failed.";
            setError(message);
          },
        });
        if (
          !realtimeMountedRef.current ||
          realtimeConnectSeqRef.current !== connectSeq
        ) {
          session.stop("user");
          return false;
        }
        realtimeSessionRef.current = session;
        setClockNow(Date.now());
        setRealtimeExpiresAt(session.expiresAt);
        setRealtimeLive(true);
        return true;
      } catch (realtimeError) {
        if (
          !realtimeMountedRef.current ||
          realtimeConnectSeqRef.current !== connectSeq
        ) {
          return false;
        }
        const message =
          realtimeError instanceof Error ? realtimeError.message : "Live voice failed.";
        setError(message);
        realtimeSessionRef.current = null;
        setRealtimeLive(false);
        setRealtimeStatus("error");
        return false;
      } finally {
        if (
          realtimeMountedRef.current &&
          realtimeConnectSeqRef.current === connectSeq
        ) {
          setBusy(false);
        }
      }
    },
    [
      appendRealtimeTurn,
      firstPrompt,
      markRealtimeUserSpeech,
      onCreateRealtimeCall,
      onEndRealtimeCall,
      onRecordRealtimeUsage,
      realtimeEnabled,
      trigger,
      updateRealtimeStatus,
    ],
  );

  const handleClose = useCallback(() => {
    stopRealtime("user");
    onClose();
  }, [onClose, stopRealtime]);

  const stopRecordingOnly = useCallback(async () => {
    if (recorderState.isRecording || recordingActiveRef.current) {
      try {
        await recorder.stop();
        recordingActiveRef.current = false;
        return recorder.uri ?? undefined;
      } finally {
        await restorePlaybackAudioMode().catch(() => {});
      }
    }
    return undefined;
  }, [recorder, recorderState.isRecording]);

  const startRecording = useCallback(async () => {
    setError("");
    try {
      await ensureRecordingPermissionAsync();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingActiveRef.current = true;
    } catch (recordError) {
      recordingActiveRef.current = false;
      await restorePlaybackAudioMode().catch(() => {});
      const message = recordError instanceof Error ? recordError.message : "Microphone permission is needed.";
      setError(message);
    }
  }, [recorder]);

  const submitTurn = useCallback(
    async (recordedUri?: string) => {
      if (busy) return;
      const cleanText = typedText.trim();

      if (realtimeEnabled) {
        if (!cleanText) {
          setError("Speak live or type a quick reply.");
          return;
        }
        setError("");
        let session = realtimeSessionRef.current;
        if (!session) {
          const started = await startRealtime(false);
          session = realtimeSessionRef.current;
          if (!started || !session) return;
        }
        appendRealtimeTurn("user", cleanText);
        session.sendText(cleanText);
        setTypedText("");
        setCanComplete(true);
        return;
      }

      if (!recordedUri && !cleanText) {
        setError("Record a response or type a quick reply.");
        return;
      }
      setBusy(true);
      setError("");
      try {
        let audioBase64: string | undefined;
        if (recordedUri) {
          audioBase64 = await FileSystem.readAsStringAsync(recordedUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }
        const result = await onContinue({
          turns,
          audioBase64,
          mimeType: recordedUri ? RECORDING_MIME_TYPE : undefined,
          typedText: cleanText || undefined,
          trigger,
        });
        const userText = result.userTranscript?.trim() || cleanText || "Voice response";
        const assistantText =
          result.assistantText?.trim() ||
          "That makes sense. What is one small thing you want to do next?";
        const nextTurns: CoachTurn[] = [
          ...turns,
          { role: "user", text: userText, at: Date.now() },
          { role: "assistant", text: assistantText, at: Date.now() + 1 },
        ];
        setTurns(nextTurns);
        setTypedText("");
        setCanComplete(Boolean(result.shouldComplete) || nextTurns.filter((t) => t.role === "user").length >= 2);
        speak(assistantText);
      } catch (turnError) {
        const message = turnError instanceof Error ? turnError.message : "Coach response failed.";
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [
      appendRealtimeTurn,
      busy,
      onContinue,
      realtimeEnabled,
      speak,
      startRealtime,
      trigger,
      turns,
      typedText,
    ],
  );

  const handleMicPress = useCallback(async () => {
    if (busy || completing) return;
    if (realtimeEnabled) {
      if (realtimeSessionRef.current || realtimeLive) {
        stopRealtime();
        return;
      }
      await startRealtime(true);
      return;
    }
    if (recorderState.isRecording || recordingActiveRef.current) {
      try {
        const uri = await stopRecordingOnly();
        await submitTurn(uri);
      } catch (recordError) {
        const message =
          recordError instanceof Error ? recordError.message : "Could not stop the recording.";
        setError(message);
      }
      return;
    }
    await startRecording();
  }, [
    busy,
    completing,
    realtimeEnabled,
    realtimeLive,
    recorderState.isRecording,
    startRealtime,
    startRecording,
    stopRealtime,
    stopRecordingOnly,
    submitTurn,
  ]);

  const handleFinish = useCallback(async () => {
    if (completing || busy) return;
    setCompleting(true);
    setError("");
    try {
      const finalTurns = turnsRef.current;
      stopRealtime("completed");
      const completedAt = Date.now();
      const summary = await onSummarize({ turns: finalTurns, trigger });
      const sessionId = await onSaveSession({
        turns: finalTurns,
        transcript: summary.transcript,
        summary: summary.summary,
        note: summary.note,
        trigger,
        startedAt,
        completedAt,
        durationSec: Math.max(1, Math.round((completedAt - startedAt) / 1000)),
      });
      await onComplete({
        transcript: summary.transcript,
        summary: summary.summary,
        note: summary.note,
        coachSessionId: sessionId,
      });
    } catch (finishError) {
      const message = finishError instanceof Error ? finishError.message : "Could not save this session.";
      setError(message);
    } finally {
      setCompleting(false);
    }
  }, [busy, completing, onComplete, onSaveSession, onSummarize, startedAt, stopRealtime, trigger]);

  const rewardLine = `+${reward.minutes} min  +${reward.vp} VP`;
  const micActive = realtimeEnabled ? realtimeLive : recorderState.isRecording;
  const micDisabled = busy || completing;
  const inputEditable = !busy && !completing && (realtimeEnabled || !recorderState.isRecording);
  const finishBlockedByVoice = realtimeEnabled ? realtimeStatus === "connecting" : recorderState.isRecording;
  const realtimeTimeLeftMs = realtimeExpiresAt
    ? Math.max(0, realtimeExpiresAt - clockNow)
    : 0;
  const recordHint = realtimeEnabled
    ? realtimeLive && realtimeExpiresAt
      ? `${realtimeHint(realtimeStatus, realtimeLive)} ${formatCountdown(
          realtimeTimeLeftMs,
        )} left (5 min max).`
      : realtimeHint(realtimeStatus, realtimeLive)
    : recorderState.isRecording
      ? `Recording ${formatDuration(recorderState.durationMillis)}`
      : "Tap the mic, speak, then tap stop.";

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.topBar}>
        <Pressable onPress={handleClose} style={styles.iconBtn} disabled={busy || completing}>
          <MaterialIcons name="close" size={24} color={C.black} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.kicker}>{trigger ? "Mindful reset" : "Coach session"}</Text>
          <Text style={styles.title}>{activity.name}</Text>
        </View>
        <View style={styles.iconBtn}>
          <MaterialIcons name="graphic-eq" size={22} color={activity.color} />
        </View>
      </View>

      <View style={styles.hero}>
        <View style={[styles.activityIcon, { backgroundColor: activity.color }]}>
          <MaterialIcons name={activity.icon as any} size={28} color={C.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroText}>
            {trigger
              ? "Use this pause to notice the urge before buying more scroll time."
              : "Talk it through. Volt will summarize the session when you finish."}
          </Text>
          <Text style={styles.rewardText}>{rewardLine}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        showsVerticalScrollIndicator={false}
      >
        {turns.map((turn, index) => (
          <View
            key={`${turn.at}-${index}`}
            style={[
              styles.bubble,
              turn.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text style={styles.bubbleLabel}>{turn.role === "user" ? "You" : "Volt"}</Text>
            <Text style={styles.bubbleText}>{turn.text}</Text>
          </View>
        ))}
        {busy ? (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <ActivityIndicator color={activity.color} />
          </View>
        ) : null}
      </ScrollView>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          value={typedText}
          onChangeText={setTypedText}
          placeholder="Optional typed reply..."
          placeholderTextColor="#999"
          style={styles.input}
          multiline
          editable={inputEditable}
        />
        <View style={styles.controls}>
          <Pressable
            onPress={handleMicPress}
            style={[
              styles.micBtn,
              micActive && styles.micBtnActive,
              micDisabled && styles.disabled,
            ]}
            disabled={micDisabled}
          >
            <MaterialIcons name={micActive ? "stop" : "mic"} size={24} color={C.white} />
          </Pressable>
          <Pressable
            onPress={() => {
              void submitTurn(undefined);
            }}
            style={[styles.sendBtn, (!typedText.trim() || busy || completing) && styles.disabled]}
            disabled={!typedText.trim() || busy || completing}
          >
            <MaterialIcons name="send" size={20} color={C.black} />
          </Pressable>
        </View>
        <Text style={styles.recordHint}>{recordHint}</Text>
      </View>

      <Pressable
        style={[
          styles.finishBtn,
          (!canComplete || completing || busy || finishBlockedByVoice) && styles.finishDisabled,
        ]}
        onPress={handleFinish}
        disabled={!canComplete || completing || busy || finishBlockedByVoice}
      >
        <Text style={styles.finishText}>{completing ? "Saving..." : "Finish session"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.soft,
    paddingHorizontal: 18,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    alignItems: "center",
  },
  kicker: {
    color: C.mutedFg,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: C.black,
    fontSize: 22,
    fontWeight: "900",
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 2,
    borderColor: C.black,
    backgroundColor: C.white,
    borderRadius: 8,
    padding: 14,
    marginTop: 8,
  },
  activityIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  heroText: {
    color: C.black,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  rewardText: {
    marginTop: 4,
    color: C.hotPink,
    fontSize: 13,
    fontWeight: "900",
  },
  thread: {
    flex: 1,
    marginTop: 14,
  },
  threadContent: {
    paddingBottom: 14,
    gap: 10,
  },
  bubble: {
    maxWidth: "86%",
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 8,
    padding: 12,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: C.white,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: C.yellow,
  },
  bubbleLabel: {
    color: C.mutedFg,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  bubbleText: {
    color: C.black,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  errorText: {
    color: C.red,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 8,
  },
  composer: {
    borderWidth: 2,
    borderColor: C.black,
    backgroundColor: C.white,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  input: {
    minHeight: 46,
    maxHeight: 92,
    color: C.black,
    fontSize: 15,
    fontWeight: "700",
    padding: 0,
  },
  controls: {
    flexDirection: "row",
    gap: 10,
  },
  micBtn: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: C.black,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnActive: {
    backgroundColor: C.hotPink,
  },
  sendBtn: {
    width: 58,
    height: 48,
    borderRadius: 8,
    backgroundColor: C.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.45,
  },
  recordHint: {
    color: C.mutedFg,
    fontSize: 12,
    fontWeight: "800",
  },
  finishBtn: {
    height: 54,
    borderRadius: 8,
    backgroundColor: C.hotPink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  finishDisabled: {
    backgroundColor: C.muted,
  },
  finishText: {
    color: C.white,
    fontSize: 16,
    fontWeight: "900",
  },
});
