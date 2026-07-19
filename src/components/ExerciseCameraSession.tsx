import { MaterialIcons } from "@react-native-vector-icons/material-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line } from "react-native-svg";
import {
  advanceRepCounter,
  advanceHoldState,
  createInitialRepState,
  createInitialHoldState,
  exerciseMode,
  type ExerciseType,
  type PoseLandmark,
  type RepCounterState,
  type HoldState,
} from "../lib/pose/repCounter";
import { coachCueForExercise } from "../lib/coachCues";
import {
  startRealtimeCoachSession,
  type RealtimeCoachSessionHandle,
  type RealtimeCreateCallResult,
  type RealtimeUsage,
  type RealtimeVoiceEndReason,
  type RealtimeVoiceStatus,
} from "../lib/openaiRealtimeWebrtc";

/* eslint-disable @typescript-eslint/no-require-imports */
let VisionCamera: typeof import("react-native-vision-camera") | null = null;
let Worklets: typeof import("react-native-worklets-core").Worklets | null = null;
try {
  VisionCamera = require("react-native-vision-camera");
} catch {
  VisionCamera = null;
}
try {
  Worklets = require("react-native-worklets-core").Worklets;
} catch {
  Worklets = null;
}

const CameraView = VisionCamera?.Camera ?? null;
const useCameraDeviceCompat = (VisionCamera?.useCameraDevice ??
  (() => null)) as (position: "front" | "back") => any;
const useCameraPermissionCompat = (VisionCamera?.useCameraPermission ??
  (() => ({
    hasPermission: false,
    requestPermission: async () => false,
  }))) as () => {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
};
const useFrameProcessorCompat = (VisionCamera?.useFrameProcessor ??
  (() => undefined)) as (
  callback: (frame: unknown) => void,
  dependencies: readonly unknown[]
) => unknown;
const runAtTargetFpsCompat = (VisionCamera?.runAtTargetFps ??
  ((_: number, callback: () => void) => callback())) as (
  fps: number,
  callback: () => void
) => void;

type PoseDetectionResultLike = {
  landmarks?: {
      x: number;
      y: number;
      z?: number;
      visibility?: number;
      presence?: number;
    }[][];
  frameWidth?: number;
  frameHeight?: number;
  isMirrored?: boolean;
  orientation?: number | string;
};

type DetectPoseLandmarksFn = (frame: unknown) => PoseDetectionResultLike | null;
let detectPoseLandmarksWorklet: DetectPoseLandmarksFn | null = null;
try {
  detectPoseLandmarksWorklet =
    require("../../modules/pose-landmarker-frame-processor").detectPoseLandmarks as DetectPoseLandmarksFn;
} catch {
  detectPoseLandmarksWorklet = null;
}
/* eslint-enable @typescript-eslint/no-require-imports */

type ExerciseCameraSessionProps = {
  readonly exerciseKey: ExerciseType;
  readonly exerciseLabel: string;
  readonly targetReps?: number;
  readonly targetDurationSec?: number;
  readonly onCreateRealtimeCall: (args: {
    offerSdp: string;
  }) => Promise<RealtimeCreateCallResult>;
  readonly onEndRealtimeCall: (args: {
    sessionId: RealtimeCreateCallResult["sessionId"];
    reason: RealtimeVoiceEndReason;
  }) => Promise<unknown>;
  readonly onRecordRealtimeUsage: (args: {
    sessionId: RealtimeCreateCallResult["sessionId"];
    responseId: string;
    usage: RealtimeUsage;
  }) => Promise<unknown>;
  readonly onCancel: () => void;
  readonly onComplete: (completedReps: number) => void;
};

type Size = {
  width: number;
  height: number;
};

const POSE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21],
  [16, 18], [16, 20], [16, 22],
  [11, 23], [12, 24],
  [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
  [27, 29], [29, 31],
  [28, 30], [30, 32],
];

const SMOOTHING_ALPHA = 0.45;

function smoothLandmarks(
  current: PoseLandmark[],
  previous: PoseLandmark[] | null,
): PoseLandmark[] {
  if (!previous || previous.length !== current.length) return current;
  const a = SMOOTHING_ALPHA;
  const b = 1 - a;
  return current.map((c, i) => {
    const p = previous[i];
    if (!p) return c;
    return {
      ...c,
      x: a * c.x + b * p.x,
      y: a * c.y + b * p.y,
      z: c.z != null && p.z != null ? a * c.z + b * p.z : c.z,
    };
  });
}

function formatSecs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function ExerciseCameraSession(
  props: ExerciseCameraSessionProps,
) {
  return (
    <ExerciseCameraSessionContent
      key={props.exerciseKey}
      {...props}
    />
  );
}

function ExerciseCameraSessionContent({
  exerciseKey,
  exerciseLabel,
  targetReps = 10,
  targetDurationSec = 20,
  onCreateRealtimeCall,
  onEndRealtimeCall,
  onRecordRealtimeUsage,
  onCancel,
  onComplete,
}: ExerciseCameraSessionProps) {
  const insets = useSafeAreaInsets();
  const mode = exerciseMode(exerciseKey);

  // Rep mode state
  const [counterState, setCounterState] = useState<RepCounterState>(() =>
    createInitialRepState(exerciseKey),
  );

  // Hold mode state
  const [holdState, setHoldState] = useState<HoldState>(() =>
    createInitialHoldState(exerciseKey),
  );
  const holdCompletedRef = useRef(false);

  // Shared state
  const [latestPose, setLatestPose] = useState<PoseLandmark[] | null>(null);
  const [hasRecentPose, setHasRecentPose] = useState(false);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const [frameOrientation, setFrameOrientation] = useState<number | string | null>(null);
  const [previewSize, setPreviewSize] = useState<Size | null>(null);
  const [debugAngle, setDebugAngle] = useState<number | null>(null);
  const [debugQuality, setDebugQuality] = useState(false);
  const [debugSecondaryAngle, setDebugSecondaryAngle] = useState<number | null>(null);
  const device = useCameraDeviceCompat("front");
  const { hasPermission, requestPermission } = useCameraPermissionCompat();
  const hasRecentPoseRef = useRef(false);
  const poseStaleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeSessionRef = useRef<RealtimeCoachSessionHandle | null>(null);
  const realtimeCreateCallRef = useRef(onCreateRealtimeCall);
  const realtimeEndCallRef = useRef(onEndRealtimeCall);
  const realtimeUsageRef = useRef(onRecordRealtimeUsage);
  const realtimeConnectSeqRef = useRef(0);
  const realtimeConnectingRef = useRef(false);
  const realtimeMountedRef = useRef(true);
  const lastMovementEventKeyRef = useRef("");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeVoiceStatus>("idle");
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [realtimeExpiresAt, setRealtimeExpiresAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [voiceCoachText, setVoiceCoachText] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [appState, setAppState] = useState(() => AppState.currentState);
  const [cancelPending, setCancelPending] = useState(false);
  const cancelPendingRef = useRef(false);

  useEffect(() => {
    realtimeCreateCallRef.current = onCreateRealtimeCall;
    realtimeEndCallRef.current = onEndRealtimeCall;
    realtimeUsageRef.current = onRecordRealtimeUsage;
  }, [onCreateRealtimeCall, onEndRealtimeCall, onRecordRealtimeUsage]);

  useEffect(() => {
    if (!realtimeExpiresAt || !realtimeConnected) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [realtimeConnected, realtimeExpiresAt]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(
    () => () => {
      if (poseStaleTimeoutRef.current) {
        clearTimeout(poseStaleTimeoutRef.current);
        poseStaleTimeoutRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!CameraView || hasPermission) return;
    void requestPermission();
  }, [hasPermission, requestPermission]);

  const runtimeState = useMemo(() => {
    if (!CameraView) return "camera-unavailable";
    if (!hasPermission) return "permission-needed";
    if (!device) return "device-unavailable";
    return "camera-ready";
  }, [hasPermission, device]);

  const stopRealtime = useCallback(async (reason: RealtimeVoiceEndReason = "user") => {
    realtimeConnectSeqRef.current += 1;
    realtimeConnectingRef.current = false;
    const session = realtimeSessionRef.current;
    realtimeSessionRef.current = null;
    if (realtimeMountedRef.current) {
      setRealtimeConnected(false);
      setRealtimeExpiresAt(null);
      setRealtimeStatus("idle");
    }
    await session?.stop(reason);
  }, []);

  const startRealtime = useCallback(async () => {
    if (realtimeSessionRef.current || realtimeConnectingRef.current) return;

    const connectSeq = realtimeConnectSeqRef.current + 1;
    realtimeConnectSeqRef.current = connectSeq;
    realtimeConnectingRef.current = true;
    setVoiceError("");
    setRealtimeStatus("connecting");

    const openingPrompt =
      mode === "reps"
        ? `Let's do ${targetReps} ${exerciseLabel}. Get your full body in frame and start when ready.`
        : `Let's hold ${exerciseLabel} for ${targetDurationSec} seconds. Get into position and I will coach you.`;

    try {
      const session = await startRealtimeCoachSession({
        openingPrompt,
        createCall: ({ offerSdp }) => realtimeCreateCallRef.current({ offerSdp }),
        endCall: (args) => realtimeEndCallRef.current(args),
        recordUsage: (args) => realtimeUsageRef.current(args),
        onStatus: (status) => {
          if (!realtimeMountedRef.current || realtimeConnectSeqRef.current !== connectSeq) return;
          setRealtimeStatus(status);
          if (status === "closed" || status === "error") {
            setRealtimeConnected(false);
          }
        },
        onUserTranscript: () => {},
        onAssistantTranscript: (text) => {
          if (!realtimeMountedRef.current || realtimeConnectSeqRef.current !== connectSeq) return;
          setVoiceCoachText(text);
        },
        onEnded: (reason) => {
          if (!realtimeMountedRef.current || realtimeConnectSeqRef.current !== connectSeq) return;
          realtimeConnectSeqRef.current += 1;
          realtimeConnectingRef.current = false;
          realtimeSessionRef.current = null;
          setRealtimeConnected(false);
          setRealtimeExpiresAt(null);
          setRealtimeStatus("idle");
          if (reason === "client_idle") {
            setVoiceError("Voice disconnected after 60 seconds without conversation.");
          } else if (reason === "client_limit") {
            setVoiceError("This live voice session reached its 5-minute limit.");
          }
        },
        onError: (error) => {
          if (!realtimeMountedRef.current || realtimeConnectSeqRef.current !== connectSeq) return;
          setVoiceError(error.message);
          setRealtimeStatus("error");
          setRealtimeConnected(false);
        },
      });

      if (!realtimeMountedRef.current || realtimeConnectSeqRef.current !== connectSeq) {
        await session.stop("user");
        return;
      }
      realtimeSessionRef.current = session;
      setClockNow(Date.now());
      setRealtimeExpiresAt(session.expiresAt);
      setRealtimeConnected(true);
    } catch (error) {
      if (!realtimeMountedRef.current || realtimeConnectSeqRef.current !== connectSeq) return;
      setVoiceError(error instanceof Error ? error.message : "Realtime exercise coaching failed.");
      setRealtimeStatus("error");
      setRealtimeConnected(false);
    } finally {
      if (realtimeConnectSeqRef.current === connectSeq) {
        realtimeConnectingRef.current = false;
      }
    }
  }, [exerciseLabel, mode, targetDurationSec, targetReps]);

  useEffect(() => {
    realtimeMountedRef.current = true;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    if (hasPermission || !CameraView) {
      startTimer = setTimeout(() => {
        void startRealtime();
      }, 0);
    }
    return () => {
      if (startTimer) clearTimeout(startTimer);
      realtimeMountedRef.current = false;
      realtimeConnectSeqRef.current += 1;
      realtimeConnectingRef.current = false;
      const session = realtimeSessionRef.current;
      realtimeSessionRef.current = null;
      void session?.stop("user");
    };
  }, [hasPermission, startRealtime]);

  const toggleRealtime = useCallback(() => {
    if (realtimeStatus === "connecting") {
      void stopRealtime();
      return;
    }
    if (realtimeConnected && realtimeStatus !== "error") {
      void stopRealtime();
      return;
    }
    void stopRealtime();
    void startRealtime();
  }, [realtimeConnected, realtimeStatus, startRealtime, stopRealtime]);

  const onPoseDetected = useCallback(
    (result: PoseDetectionResultLike) => {
      const firstPose = result.landmarks?.[0];
      if (!firstPose || firstPose.length === 0) return;

      setLatestPose((prev) => smoothLandmarks(firstPose, prev));
      if (result.frameWidth && result.frameHeight) {
        setFrameSize((previous) =>
          previous?.width === result.frameWidth && previous?.height === result.frameHeight
            ? previous
            : { width: result.frameWidth!, height: result.frameHeight! },
        );
      }
      if (typeof result.orientation === "number" || typeof result.orientation === "string") {
        setFrameOrientation((previous) =>
          previous === result.orientation ? previous : result.orientation!,
        );
      }
      if (!hasRecentPoseRef.current) {
        hasRecentPoseRef.current = true;
        setHasRecentPose(true);
      }
      if (poseStaleTimeoutRef.current) {
        clearTimeout(poseStaleTimeoutRef.current);
      }
      poseStaleTimeoutRef.current = setTimeout(() => {
        poseStaleTimeoutRef.current = null;
        hasRecentPoseRef.current = false;
        setHasRecentPose(false);
      }, 1400);

      const now = Date.now();

      if (mode === "reps") {
        setCounterState((prev) => {
          const { nextState, metrics } = advanceRepCounter(prev, firstPose, now);
          setDebugAngle(metrics.primaryAngle);
          setDebugSecondaryAngle(metrics.secondaryAngle);
          setDebugQuality(metrics.qualityOk);
          return nextState;
        });
      } else {
        setHoldState((prev) => {
          const { nextState, metrics } = advanceHoldState(prev, firstPose, now);
          setDebugAngle(metrics.primaryAngle);
          setDebugSecondaryAngle(metrics.secondaryAngle);
          setDebugQuality(metrics.qualityOk);
          return nextState;
        });
      }
    },
    [mode]
  );

  const onPoseDetectedRunOnJS = useMemo(
    // The worklet bridge stores this callback; it does not invoke/read its refs during render.
    // eslint-disable-next-line react-hooks/refs
    () => Worklets?.createRunOnJS(onPoseDetected),
    [onPoseDetected]
  );
  const frameProcessor = useFrameProcessorCompat(
    (frame) => {
      "worklet";
      if (!detectPoseLandmarksWorklet || !onPoseDetectedRunOnJS) return;
      runAtTargetFpsCompat(15, () => {
        "worklet";
        const result = detectPoseLandmarksWorklet(frame);
        if (!result) return;
        onPoseDetectedRunOnJS(result);
      });
    },
    [onPoseDetectedRunOnJS]
  );

  // Derived values
  const isAutoCountingEnabled =
    runtimeState === "camera-ready" &&
    typeof detectPoseLandmarksWorklet === "function" &&
    typeof onPoseDetectedRunOnJS === "function";

  // Rep mode derived
  const repCount = counterState.repCount;
  const repsLeft = Math.max(0, targetReps - repCount);
  const repsDone = mode === "reps" && repsLeft === 0;

  // Hold mode derived
  const holdSec = Math.floor(holdState.accumulatedMs / 1000);
  const holdTargetMs = targetDurationSec * 1000;
  const holdDone = mode === "hold" && holdState.accumulatedMs >= holdTargetMs;

  useEffect(() => {
    if (holdDone && !holdCompletedRef.current) {
      holdCompletedRef.current = true;
    }
  }, [holdDone]);

  const isDone = mode === "reps" ? repsDone : holdDone;
  const localCoachCue = coachCueForExercise({
    exerciseLabel,
    mode,
    repCount,
    targetReps,
    holdSec,
    targetDurationSec,
    hasRecentPose,
    qualityOk: debugQuality,
    inPosition: holdState.inPosition,
  });

  const coachText = voiceCoachText || localCoachCue;
  const realtimeActive =
    realtimeConnected &&
    realtimeStatus !== "closed" &&
    realtimeStatus !== "error" &&
    realtimeStatus !== "idle";
  const realtimeTimeLeftMs = realtimeExpiresAt
    ? Math.max(0, realtimeExpiresAt - clockNow)
    : 0;

  useEffect(() => {
    const session = realtimeSessionRef.current;
    if (!realtimeConnected || !session) return;

    let eventKey: string;
    let eventText: string;
    if (mode === "reps") {
      if (repCount <= 0) return;
      eventKey = `reps:${repCount}:${isDone ? "done" : "active"}`;
      eventText = [
        "[LOCAL_ACTIVITY_EVENT]",
        `exercise=${exerciseLabel}`,
        "mode=reps",
        `completed_reps=${repCount}`,
        `target_reps=${targetReps}`,
        `remaining_reps=${repsLeft}`,
        `form_quality=${debugQuality ? "ok" : "unclear"}`,
        `completed=${isDone ? "yes" : "no"}`,
      ].join("; ");
    } else {
      if (holdSec <= 0 && !holdState.inPosition) return;
      const holdMilestone = Math.floor(holdSec / 5);
      eventKey = `hold:${holdMilestone}:${holdState.inPosition ? "holding" : "paused"}:${
        isDone ? "done" : "active"
      }`;
      eventText = [
        "[LOCAL_ACTIVITY_EVENT]",
        `exercise=${exerciseLabel}`,
        "mode=hold",
        `hold_seconds=${holdSec}`,
        `target_seconds=${targetDurationSec}`,
        `remaining_seconds=${Math.max(0, targetDurationSec - holdSec)}`,
        `in_position=${holdState.inPosition ? "yes" : "no"}`,
        `form_quality=${debugQuality ? "ok" : "unclear"}`,
        `completed=${isDone ? "yes" : "no"}`,
      ].join("; ");
    }

    if (lastMovementEventKeyRef.current === eventKey) return;
    lastMovementEventKeyRef.current = eventKey;
    session.sendText(eventText, { replacePending: true });
  }, [
    debugQuality,
    exerciseLabel,
    holdSec,
    holdState.inPosition,
    isDone,
    mode,
    realtimeConnected,
    repCount,
    repsLeft,
    targetDurationSec,
    targetReps,
  ]);

  // Mapped overlay points
  const mappedPoints = useMemo(() => {
    if (!latestPose || !previewSize || !frameSize) return [];

    const bufW = frameSize.width;
    const bufH = frameSize.height;
    const viewW = previewSize.width;
    const viewH = previewSize.height;
    const ori = frameOrientation;

    if (bufW <= 0 || bufH <= 0 || viewW <= 0 || viewH <= 0) return [];

    let portraitW: number;
    let portraitH: number;
    const toPortrait = (nx: number, ny: number): [number, number] => {
      switch (ori) {
        case "landscape-left":
        case 2: return [1 - ny, nx];
        case "landscape-right":
        case 3: return [ny, 1 - nx];
        case "portrait-upside-down":
        case 1: return [1 - nx, 1 - ny];
        default: return [nx, ny];
      }
    };

    if (ori === 2 || ori === 3 || ori === "landscape-left" || ori === "landscape-right") {
      portraitW = bufH;
      portraitH = bufW;
    } else {
      portraitW = bufW;
      portraitH = bufH;
    }

    const scale = Math.max(viewW / portraitW, viewH / portraitH);
    const scaledW = portraitW * scale;
    const scaledH = portraitH * scale;
    const cropX = (scaledW - viewW) / 2;
    const cropY = (scaledH - viewH) / 2;

    return latestPose.map((point, index) => {
      const nx = Math.max(0, Math.min(1, point.x));
      const ny = Math.max(0, Math.min(1, point.y));
      const [px, py] = toPortrait(nx, ny);
      const viewX = px * scaledW - cropX;
      const viewY = py * scaledH - cropY;
      const visible = (point.visibility ?? 1) > 0.2 && (point.presence ?? 1) > 0.2;
      return { index, x: viewX, y: viewY, visible };
    });
  }, [latestPose, previewSize, frameSize, frameOrientation]);

  // Helper text
  let helperText = "VisionCamera needs a development build. Expo Go will show this fallback.";
  if (runtimeState === "camera-ready" && isAutoCountingEnabled) {
    if (hasRecentPose) {
      helperText = mode === "reps"
        ? "Pose detected. Move through full reps to increase the counter."
        : holdState.inPosition
          ? "Hold steady! Timer is running."
          : "Get into position and hold it to start the timer.";
    } else {
      helperText = "Auto counting is on, but no pose yet. Step back and keep your full body visible.";
    }
  } else if (runtimeState === "camera-ready") {
    helperText = Worklets
      ? "Camera is ready, but the pose plugin is not loaded. Rebuild the dev client and retry."
      : "Camera is ready, but Worklets is missing from this build. Rebuild the dev client and retry.";
  } else if (runtimeState === "permission-needed") {
    helperText = "Allow camera permission to use front-camera exercise verification.";
  }

  // Badge display
  const badgeText = mode === "reps" ? `${repCount}` : formatSecs(holdState.accumulatedMs);
  const badgeStyle = mode === "hold" && holdState.inPosition
    ? [styles.repBadge, styles.holdBadgeActive]
    : styles.repBadge;

  // Progress / CTA text
  let ctaLabel: string;
  if (isDone) {
    ctaLabel = "Complete Activity";
  } else if (mode === "reps") {
    ctaLabel = `${repsLeft} reps left`;
  } else {
    const secsLeft = Math.max(0, targetDurationSec - holdSec);
    ctaLabel = `${secsLeft}s remaining`;
  }

  // Instructions
  const instructionText = mode === "reps"
    ? "Put your entire body in frame and follow the rep guide."
    : "Get into position and hold it. Timer pauses if you break form.";

  const handleComplete = async () => {
    if (!isDone || cancelPendingRef.current) return;
    await stopRealtime("completed");
    onComplete(mode === "reps" ? repCount : holdSec);
  };

  const confirmCancel = useCallback(() => {
    if (cancelPendingRef.current) return;
    Alert.alert(
      "Are you sure you want to stop?",
      "Your progress in this activity will not be counted.",
      [
        { text: "Keep going", style: "cancel" },
        {
          text: "Stop activity",
          style: "destructive",
          onPress: () => {
            if (cancelPendingRef.current) return;
            cancelPendingRef.current = true;
            setCancelPending(true);
            void (async () => {
              await stopRealtime("user");
              onCancel();
            })();
          },
        },
      ],
    );
  }, [onCancel, stopRealtime]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmCancel();
      return true;
    });
    return () => subscription.remove();
  }, [confirmCancel]);

  const handleReset = () => {
    lastMovementEventKeyRef.current = "";
    setVoiceCoachText("");
    if (mode === "reps") {
      setCounterState(createInitialRepState(exerciseKey));
    } else {
      setHoldState(createInitialHoldState(exerciseKey));
      holdCompletedRef.current = false;
    }
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 12) + 8,
          paddingBottom: Math.max(insets.bottom, 10) + 8,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={confirmCancel}
          disabled={cancelPending}
          style={[styles.headerBtn, cancelPending && styles.headerBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Close exercise"
        >
          <MaterialIcons name="arrow-back-ios-new" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>{exerciseLabel}</Text>
        <Pressable
          onPress={toggleRealtime}
          disabled={cancelPending}
          style={[styles.headerBtn, cancelPending && styles.headerBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel={realtimeActive ? "Stop live voice coach" : "Start live voice coach"}
        >
          <MaterialIcons
            name={realtimeActive ? "graphic-eq" : realtimeStatus === "connecting" ? "sync" : "mic"}
            size={22}
            color={realtimeActive ? "#00E5A0" : "#FFFFFF"}
          />
        </Pressable>
      </View>

      <View style={styles.cameraCard}>
        {CameraView && runtimeState === "camera-ready" ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={appState === "active"}
            photo={false}
            video={false}
            audio={false}
            pixelFormat="rgb"
            frameProcessor={isAutoCountingEnabled ? (frameProcessor as any) : undefined}
          />
        ) : (
          <View style={styles.fallbackCenter}>
            <MaterialIcons name="videocam-off" size={40} color="rgba(255,255,255,0.8)" />
            <Text style={styles.fallbackText}>Camera Preview Unavailable</Text>
          </View>
        )}

        <View style={badgeStyle}>
          <Text style={mode === "hold" ? styles.holdCount : styles.repCount}>
            {badgeText}
          </Text>
        </View>

        <View
          pointerEvents="none"
          style={styles.poseOverlay}
          onLayout={(event) =>
            setPreviewSize({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })
          }
        >
          {previewSize ? (
            <Svg width={previewSize.width} height={previewSize.height}>
              {POSE_CONNECTIONS.map(([a, b]) => {
                const pa = mappedPoints[a];
                const pb = mappedPoints[b];
                if (!pa || !pb || !pa.visible || !pb.visible) return null;
                return (
                  <Line
                    key={`line-${a}-${b}`}
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke="rgba(35, 224, 255, 0.75)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                );
              })}
              {mappedPoints.map((point) => {
                if (!point.visible) return null;
                const isJoint = point.index >= 11 && point.index <= 28;
                const isFace = point.index <= 10;
                const r = isJoint ? 5 : isFace ? 2.5 : 3;
                const fill = isJoint
                  ? "rgba(0, 255, 245, 0.95)"
                  : "rgba(255, 255, 255, 0.7)";
                return (
                  <Circle
                    key={`pt-${point.index}`}
                    cx={point.x}
                    cy={point.y}
                    r={r}
                    fill={fill}
                    stroke="rgba(0, 0, 0, 0.3)"
                    strokeWidth={0.8}
                  />
                );
              })}
            </Svg>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.bottomScroll}
        contentContainerStyle={styles.bottomScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <Text style={styles.instructions}>{instructionText}</Text>
        <View style={styles.coachCard}>
          <View style={[styles.coachDot, realtimeActive && styles.coachDotLive]} />
          <Text style={styles.coachText}>{coachText || localCoachCue}</Text>
        </View>
        {realtimeActive && realtimeExpiresAt ? (
          <Text style={styles.voiceTime}>
            {formatCountdown(realtimeTimeLeftMs)} voice time left · 5 min max
          </Text>
        ) : null}
        {voiceError ? <Text style={styles.voiceError}>{voiceError}</Text> : null}
        <Text style={styles.helperText}>{helperText}</Text>
        {__DEV__ ? (
          <Text style={styles.helperDebug}>
            {mode === "reps"
              ? `Phase:${counterState.phase}  Angle:${debugAngle !== null ? debugAngle.toFixed(0) : "-"}${
                  debugSecondaryAngle !== null ? `  Aux:${debugSecondaryAngle.toFixed(0)}` : ""
                }  Q:${debugQuality ? "ok" : "no"}`
              : `Hold:${holdState.inPosition ? "YES" : "no"}  ${formatSecs(holdState.accumulatedMs)}/${targetDurationSec}s  Angle:${
                  debugAngle !== null ? debugAngle.toFixed(0) : "-"
                }  Q:${debugQuality ? "ok" : "no"}`}
          </Text>
        ) : null}

        <View style={styles.bottomSpacer} />

        {__DEV__ ? (
          <View style={styles.toolsRow}>
            {mode === "reps" ? (
              <Pressable
                style={styles.toolBtn}
                onPress={() => setCounterState((prev) => ({ ...prev, repCount: prev.repCount + 1 }))}
              >
                <MaterialIcons name="add" size={18} color="#0A0A0F" />
                <Text style={styles.toolBtnText}>Test Rep</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.toolBtn}
                onPress={() =>
                  setHoldState((prev) => ({ ...prev, accumulatedMs: prev.accumulatedMs + 5000 }))
                }
              >
                <MaterialIcons name="add" size={18} color="#0A0A0F" />
                <Text style={styles.toolBtnText}>+5 sec</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.toolBtn, styles.toolBtnGhost]}
              onPress={handleReset}
            >
              <MaterialIcons name="restart-alt" size={18} color="#FFFFFF" />
              <Text style={[styles.toolBtnText, { color: "#FFFFFF" }]}>Reset</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          style={[
            styles.ctaBtn,
            (!isDone || cancelPending) && styles.ctaBtnDisabled,
          ]}
          onPress={() => void handleComplete()}
          disabled={!isDone || cancelPending}
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#05070E",
    paddingHorizontal: 18,
  },
  bottomScroll: {
    flex: 1,
    minHeight: 0,
  },
  bottomScrollContent: {
    flexGrow: 1,
    paddingTop: 12,
  },
  bottomSpacer: {
    flexGrow: 1,
    minHeight: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnDisabled: {
    opacity: 0.45,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  cameraCard: {
    width: "100%",
    /* Slightly shorter preview frees vertical space for controls on small phones */
    aspectRatio: 0.78,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#0E1322",
    justifyContent: "center",
    alignItems: "center",
  },
  fallbackCenter: {
    alignItems: "center",
    gap: 8,
  },
  fallbackText: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 13,
    fontWeight: "600",
  },
  repBadge: {
    position: "absolute",
    bottom: 18,
    alignSelf: "center",
    minWidth: 68,
    height: 68,
    borderRadius: 34,
    paddingHorizontal: 16,
    backgroundColor: "rgba(10,211,255,0.82)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
  },
  holdBadgeActive: {
    backgroundColor: "rgba(0,220,120,0.85)",
  },
  repCount: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 38,
  },
  holdCount: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  instructions: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    textAlign: "center",
    marginTop: 0,
    paddingHorizontal: 4,
    lineHeight: 21,
  },
  coachCard: {
    marginTop: 10,
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  coachDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  coachDotLive: {
    backgroundColor: "#00E5A0",
  },
  coachText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  voiceTime: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
    textAlign: "center",
  },
  voiceError: {
    color: "#FF8A8A",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 6,
    textAlign: "center",
  },
  helperText: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 12,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 17,
  },
  helperDebug: {
    color: "rgba(120,222,255,0.92)",
    fontSize: 11,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 16,
    fontWeight: "600",
  },
  poseOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  toolsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  toolBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  toolBtnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
  },
  toolBtnText: {
    color: "#0A0A0F",
    fontSize: 14,
    fontWeight: "700",
  },
  ctaBtn: {
    marginTop: 10,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnDisabled: {
    opacity: 0.45,
  },
  ctaText: {
    color: "#0A0A0F",
    fontSize: 20,
    fontWeight: "800",
  },
});
