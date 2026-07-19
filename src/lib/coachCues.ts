export function coachCueForExercise(params: {
  exerciseLabel: string;
  mode: "reps" | "hold";
  repCount: number;
  targetReps: number;
  holdSec: number;
  targetDurationSec: number;
  hasRecentPose: boolean;
  qualityOk: boolean;
  inPosition: boolean;
}): string {
  if (!params.hasRecentPose) {
    return "Step back and keep your full body in frame.";
  }
  if (!params.qualityOk) {
    return "I can see you, but the pose is unclear. Adjust your angle slightly.";
  }
  if (params.mode === "hold") {
    if (params.inPosition) {
      const left = Math.max(0, params.targetDurationSec - params.holdSec);
      return left > 0 ? `Good position. Hold ${left}s more.` : "Hold complete. Claim it.";
    }
    return "Get into position and keep your body steady.";
  }
  const left = Math.max(0, params.targetReps - params.repCount);
  if (left === 0) return "Set complete. Claim your reward.";
  if (params.repCount === 0) return `Start strong. I will count each clean ${params.exerciseLabel.toLowerCase()}.`;
  return `Good rep. ${params.repCount} done, ${left} to go.`;
}
