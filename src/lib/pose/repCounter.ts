export type ExerciseType =
  | "pushups"
  | "squats"
  | "situps"
  | "jumpingjacks"
  | "plank"
  | "wallsit";

export type ExerciseMode = "reps" | "hold";

export function exerciseMode(exercise: ExerciseType): ExerciseMode {
  if (exercise === "plank" || exercise === "wallsit") return "hold";
  return "reps";
}

export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
};

export type RepCounterState = {
  exercise: ExerciseType;
  phase: "up" | "down";
  repCount: number;
  lastTransitionMs: number;
};

export type HoldState = {
  exercise: ExerciseType;
  inPosition: boolean;
  accumulatedMs: number;
  lastTickMs: number;
};

export type RepCounterMetrics = {
  primaryAngle: number | null;
  secondaryAngle: number | null;
  qualityOk: boolean;
};

export const MEDIAPIPE_LANDMARK_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const DEFAULT_MIN_VISIBILITY = 0.2;
const MIN_REP_DURATION_MS = 250;

// Push-up: elbow angle (shoulder-elbow-wrist)
const PUSHUP_DOWN_ANGLE = 110;
const PUSHUP_UP_ANGLE = 145;

// Squat: knee angle (hip-knee-ankle)
const SQUAT_DOWN_ANGLE = 100;
const SQUAT_UP_ANGLE = 150;
const SQUAT_TORSO_MIN = 35;

// Sit-up: hip angle (shoulder-hip-knee)
const SITUP_DOWN_ANGLE = 140;
const SITUP_UP_ANGLE = 90;

// Jumping jack: wrist-above-shoulder + ankle spread thresholds
const JJ_WRIST_ABOVE_THRESHOLD = -0.06;
const JJ_ANKLE_SPREAD_OPEN = 0.15;
const JJ_ANKLE_SPREAD_CLOSED = 0.08;

// Plank: elbow angle ≥ threshold means arms are straight
const PLANK_ELBOW_MIN = 140;

// Wall sit: knee angle range for seated position
const WALLSIT_KNEE_MIN = 60;
const WALLSIT_KNEE_MAX = 120;

// ─── State constructors ───

export function createInitialRepState(exercise: ExerciseType): RepCounterState {
  return {
    exercise,
    phase: exercise === "situps" ? "down" : "up",
    repCount: 0,
    lastTransitionMs: 0,
  };
}

export function createInitialHoldState(exercise: ExerciseType): HoldState {
  return {
    exercise,
    inPosition: false,
    accumulatedMs: 0,
    lastTickMs: 0,
  };
}

// ─── Helpers ───

function getLandmark(
  landmarks: PoseLandmark[],
  index: number,
  minVisibility = DEFAULT_MIN_VISIBILITY
): PoseLandmark | null {
  const value = landmarks[index];
  if (!value) return null;
  if (typeof value.visibility === "number" && value.visibility < minVisibility) return null;
  if (typeof value.presence === "number" && value.presence < minVisibility) return null;
  return value;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, v) => sum + v, 0);
  return total / values.length;
}

function angleAt(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);
  const denominator = Math.max(magAB * magCB, 1e-6);
  const cos = Math.max(-1, Math.min(1, dot / denominator));
  return (Math.acos(cos) * 180) / Math.PI;
}

// ─── Per-exercise metrics ───

function computePushupMetrics(landmarks: PoseLandmark[]): RepCounterMetrics {
  const lS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftShoulder);
  const rS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightShoulder);
  const lE = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftElbow);
  const rE = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightElbow);
  const lW = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftWrist);
  const rW = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightWrist);
  const lH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftHip);
  const rH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightHip);
  const lA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftAnkle);
  const rA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightAnkle);

  const elbowAngles: number[] = [];
  if (lS && lE && lW) elbowAngles.push(angleAt(lS, lE, lW));
  if (rS && rE && rW) elbowAngles.push(angleAt(rS, rE, rW));

  const bodyLineAngles: number[] = [];
  if (lS && lH && lA) bodyLineAngles.push(angleAt(lS, lH, lA));
  if (rS && rH && rA) bodyLineAngles.push(angleAt(rS, rH, rA));

  const avgElbow = average(elbowAngles);
  const avgBodyLine = average(bodyLineAngles);

  return {
    primaryAngle: avgElbow,
    secondaryAngle: avgBodyLine,
    qualityOk: avgElbow !== null,
  };
}

function computeSquatMetrics(landmarks: PoseLandmark[]): RepCounterMetrics {
  const lH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftHip);
  const rH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightHip);
  const lK = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftKnee);
  const rK = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightKnee);
  const lA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftAnkle);
  const rA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightAnkle);
  const lS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftShoulder);
  const rS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightShoulder);

  const kneeAngles: number[] = [];
  if (lH && lK && lA) kneeAngles.push(angleAt(lH, lK, lA));
  if (rH && rK && rA) kneeAngles.push(angleAt(rH, rK, rA));

  const torsoAngles: number[] = [];
  if (lS && lH && lK) torsoAngles.push(angleAt(lS, lH, lK));
  if (rS && rH && rK) torsoAngles.push(angleAt(rS, rH, rK));

  const avgKnee = average(kneeAngles);
  const avgTorso = average(torsoAngles);

  return {
    primaryAngle: avgKnee,
    secondaryAngle: avgTorso,
    qualityOk: avgKnee !== null && avgTorso !== null && avgTorso >= SQUAT_TORSO_MIN,
  };
}

function computeSitupMetrics(landmarks: PoseLandmark[]): RepCounterMetrics {
  const lS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftShoulder);
  const rS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightShoulder);
  const lH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftHip);
  const rH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightHip);
  const lK = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftKnee);
  const rK = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightKnee);

  const hipAngles: number[] = [];
  if (lS && lH && lK) hipAngles.push(angleAt(lS, lH, lK));
  if (rS && rH && rK) hipAngles.push(angleAt(rS, rH, rK));

  const avgHip = average(hipAngles);

  return {
    primaryAngle: avgHip,
    secondaryAngle: null,
    qualityOk: avgHip !== null,
  };
}

function computeJumpingJackMetrics(landmarks: PoseLandmark[]): RepCounterMetrics {
  const lS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftShoulder);
  const rS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightShoulder);
  const lW = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftWrist);
  const rW = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightWrist);
  const lA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftAnkle);
  const rA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightAnkle);

  if (!lS || !rS || !lW || !rW || !lA || !rA) {
    return { primaryAngle: null, secondaryAngle: null, qualityOk: false };
  }

  // Arms score: how far above shoulders the wrists are (negative = above)
  const avgShoulderY = (lS.y + rS.y) / 2;
  const avgWristY = (lW.y + rW.y) / 2;
  const wristRelative = avgWristY - avgShoulderY;

  // Leg score: horizontal spread between ankles
  const ankleSpread = Math.abs(lA.x - rA.x);

  return {
    primaryAngle: wristRelative * 100,
    secondaryAngle: ankleSpread * 100,
    qualityOk: true,
  };
}

function computePlankMetrics(landmarks: PoseLandmark[]): RepCounterMetrics {
  const lS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftShoulder);
  const rS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightShoulder);
  const lE = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftElbow);
  const rE = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightElbow);
  const lW = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftWrist);
  const rW = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightWrist);
  const lH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftHip);
  const rH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightHip);

  const elbowAngles: number[] = [];
  if (lS && lE && lW) elbowAngles.push(angleAt(lS, lE, lW));
  if (rS && rE && rW) elbowAngles.push(angleAt(rS, rE, rW));

  const avgElbow = average(elbowAngles);

  const hasCore = (lS || rS) && (lH || rH);

  return {
    primaryAngle: avgElbow,
    secondaryAngle: null,
    qualityOk: avgElbow !== null && hasCore,
  };
}

function computeWallSitMetrics(landmarks: PoseLandmark[]): RepCounterMetrics {
  const lH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftHip);
  const rH = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightHip);
  const lK = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftKnee);
  const rK = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightKnee);
  const lA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftAnkle);
  const rA = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightAnkle);
  const lS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.leftShoulder);
  const rS = getLandmark(landmarks, MEDIAPIPE_LANDMARK_INDEX.rightShoulder);

  const kneeAngles: number[] = [];
  if (lH && lK && lA) kneeAngles.push(angleAt(lH, lK, lA));
  if (rH && rK && rA) kneeAngles.push(angleAt(rH, rK, rA));

  const avgKnee = average(kneeAngles);
  const hasUpper = (lS || rS) && (lH || rH);

  return {
    primaryAngle: avgKnee,
    secondaryAngle: null,
    qualityOk: avgKnee !== null && hasUpper,
  };
}

// ─── Metrics dispatcher ───

export function computeMetrics(
  exercise: ExerciseType,
  landmarks: PoseLandmark[],
): RepCounterMetrics {
  switch (exercise) {
    case "pushups": return computePushupMetrics(landmarks);
    case "squats": return computeSquatMetrics(landmarks);
    case "situps": return computeSitupMetrics(landmarks);
    case "jumpingjacks": return computeJumpingJackMetrics(landmarks);
    case "plank": return computePlankMetrics(landmarks);
    case "wallsit": return computeWallSitMetrics(landmarks);
  }
}

// ─── Rep counter (pushups, squats, situps, jumpingjacks) ───

export function advanceRepCounter(
  state: RepCounterState,
  landmarks: PoseLandmark[],
  timestampMs: number
): { nextState: RepCounterState; metrics: RepCounterMetrics } {
  const metrics = computeMetrics(state.exercise, landmarks);

  if (metrics.primaryAngle === null || !metrics.qualityOk) {
    return { nextState: state, metrics };
  }

  const elapsed = timestampMs - state.lastTransitionMs;
  const angle = metrics.primaryAngle;

  let isDown: boolean;
  let isUp: boolean;

  switch (state.exercise) {
    case "pushups":
      isDown = angle <= PUSHUP_DOWN_ANGLE;
      isUp = angle >= PUSHUP_UP_ANGLE;
      break;
    case "squats":
      isDown = angle <= SQUAT_DOWN_ANGLE;
      isUp = angle >= SQUAT_UP_ANGLE;
      break;
    case "situps":
      // Sit-ups: angle DECREASES when sitting up (down=lying flat=large angle)
      isDown = angle >= SITUP_DOWN_ANGLE;
      isUp = angle <= SITUP_UP_ANGLE;
      break;
    case "jumpingjacks": {
      // primaryAngle = wrist-relative * 100 (negative = above shoulder)
      // secondaryAngle = ankle-spread * 100
      const wristScore = angle;
      const ankleScore = metrics.secondaryAngle ?? 0;
      isDown = wristScore >= 0 && ankleScore <= JJ_ANKLE_SPREAD_CLOSED * 100;
      isUp = wristScore <= JJ_WRIST_ABOVE_THRESHOLD * 100 && ankleScore >= JJ_ANKLE_SPREAD_OPEN * 100;
      break;
    }
    default:
      return { nextState: state, metrics };
  }

  if (state.phase === "up" && isDown && elapsed >= MIN_REP_DURATION_MS) {
    return {
      nextState: { ...state, phase: "down", lastTransitionMs: timestampMs },
      metrics,
    };
  }

  if (state.phase === "down" && isUp && elapsed >= MIN_REP_DURATION_MS) {
    return {
      nextState: {
        ...state,
        phase: "up",
        repCount: state.repCount + 1,
        lastTransitionMs: timestampMs,
      },
      metrics,
    };
  }

  return { nextState: state, metrics };
}

// ─── Hold checker (plank, wallsit) ───

export function advanceHoldState(
  state: HoldState,
  landmarks: PoseLandmark[],
  timestampMs: number,
): { nextState: HoldState; metrics: RepCounterMetrics } {
  const metrics = computeMetrics(state.exercise, landmarks);

  if (metrics.primaryAngle === null || !metrics.qualityOk) {
    return {
      nextState: { ...state, inPosition: false, lastTickMs: timestampMs },
      metrics,
    };
  }

  const angle = metrics.primaryAngle;
  let inPosition: boolean;

  switch (state.exercise) {
    case "plank":
      inPosition = angle >= PLANK_ELBOW_MIN;
      break;
    case "wallsit":
      inPosition = angle >= WALLSIT_KNEE_MIN && angle <= WALLSIT_KNEE_MAX;
      break;
    default:
      inPosition = false;
  }

  let accumulatedMs = state.accumulatedMs;
  if (inPosition && state.inPosition && state.lastTickMs > 0) {
    const delta = timestampMs - state.lastTickMs;
    if (delta > 0 && delta < 1000) {
      accumulatedMs += delta;
    }
  }

  return {
    nextState: {
      ...state,
      inPosition,
      accumulatedMs,
      lastTickMs: timestampMs,
    },
    metrics,
  };
}
