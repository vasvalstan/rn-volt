// A coin or reward must not be earned from a broad, low-confidence location fix.
// Fifteen metres is a deliberate trade-off: it is achievable outdoors on modern
// phones while rejecting the noisy fixes that cause distance to drift at rest.
export const MAX_GPS_ACCURACY_METRES = 15;
export const MAX_GPS_SPEED_METRES_PER_SECOND = 12;
export const MAX_GPS_SEGMENT_METRES = 100;
export const GPS_SMOOTHING_WINDOW_SIZE = 3;
const MIN_GPS_CREDIT_SEGMENT_METRES = 8;

export type GpsSample = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  timestamp: number;
};

export type GpsSampleEvaluation =
  | { accepted: true; distanceM: number }
  | {
      accepted: false;
      distanceM: 0;
      reason:
        | "invalid-coordinate"
        | "poor-accuracy"
        | "stale-sample"
        | "stationary-jitter"
        | "implausible-jump"
        | "implausible-speed"
        | "warming-up";
    };

export function haversineDistance(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const earthRadiusM = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const latitudeARadians = toRadians(latitudeA);
  const latitudeBRadians = toRadians(latitudeB);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isValidCoordinate(sample: GpsSample): boolean {
  return (
    Number.isFinite(sample.latitude) &&
    Number.isFinite(sample.longitude) &&
    sample.latitude >= -90 &&
    sample.latitude <= 90 &&
    sample.longitude >= -180 &&
    sample.longitude <= 180
  );
}

function resolvedAccuracy(sample: GpsSample): number {
  return sample.accuracy === null || sample.accuracy === undefined
    ? MAX_GPS_ACCURACY_METRES
    : sample.accuracy;
}

/**
 * Filters raw phone location samples before they affect a rewarded distance.
 * Rejected samples do not replace the last accepted anchor, so real movement
 * can accumulate past the jitter threshold once GPS settles.
 */
export function evaluateGpsSample(
  previous: GpsSample | null,
  next: GpsSample,
): GpsSampleEvaluation {
  if (!isValidCoordinate(next)) {
    return { accepted: false, distanceM: 0, reason: "invalid-coordinate" };
  }

  const nextAccuracy = resolvedAccuracy(next);
  if (
    !Number.isFinite(nextAccuracy) ||
    nextAccuracy < 0 ||
    nextAccuracy > MAX_GPS_ACCURACY_METRES
  ) {
    return { accepted: false, distanceM: 0, reason: "poor-accuracy" };
  }

  if (!previous) {
    return { accepted: true, distanceM: 0 };
  }

  if (!isValidCoordinate(previous)) {
    return { accepted: false, distanceM: 0, reason: "invalid-coordinate" };
  }

  const elapsedSeconds = (next.timestamp - previous.timestamp) / 1_000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return { accepted: false, distanceM: 0, reason: "stale-sample" };
  }

  const distanceM = haversineDistance(
    previous.latitude,
    previous.longitude,
    next.latitude,
    next.longitude,
  );
  const previousAccuracy = resolvedAccuracy(previous);
  const jitterThresholdM = Math.max(
    MIN_GPS_CREDIT_SEGMENT_METRES,
    Math.min(15, Math.max(previousAccuracy, nextAccuracy) * 1.5),
  );
  if (distanceM < jitterThresholdM) {
    return { accepted: false, distanceM: 0, reason: "stationary-jitter" };
  }
  if (distanceM > MAX_GPS_SEGMENT_METRES) {
    return { accepted: false, distanceM: 0, reason: "implausible-jump" };
  }

  const reportedSpeed = next.speed ?? -1;
  const computedSpeed = distanceM / elapsedSeconds;
  if (
    (Number.isFinite(reportedSpeed) &&
      reportedSpeed >= 0 &&
      reportedSpeed > MAX_GPS_SPEED_METRES_PER_SECOND) ||
    computedSpeed > MAX_GPS_SPEED_METRES_PER_SECOND
  ) {
    return { accepted: false, distanceM: 0, reason: "implausible-speed" };
  }

  return { accepted: true, distanceM };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Converts noisy raw location fixes into a conservative, rewarded route.
 *
 * We wait for three good fixes, take the median latitude/longitude, and only
 * then evaluate the segment. A single GPS wobble can no longer add a coin's
 * worth of distance; sustained walking or running still accumulates normally.
 */
export class GpsDistanceTracker {
  private recentSamples: GpsSample[] = [];
  private lastSmoothedSample: GpsSample | null = null;

  reset(): void {
    this.recentSamples = [];
    this.lastSmoothedSample = null;
  }

  add(next: GpsSample): { evaluation: GpsSampleEvaluation; sample: GpsSample | null } {
    const qualityEvaluation = evaluateGpsSample(null, next);
    if (!qualityEvaluation.accepted) {
      return { evaluation: qualityEvaluation, sample: null };
    }

    const latest = this.recentSamples.at(-1);
    if (latest && next.timestamp - latest.timestamp > 10_000) {
      // Do not smooth a new GPS fix together with a stale pre-pause fix.
      this.recentSamples = [];
      this.lastSmoothedSample = null;
    }

    this.recentSamples = [...this.recentSamples, next].slice(-GPS_SMOOTHING_WINDOW_SIZE);
    if (this.recentSamples.length < GPS_SMOOTHING_WINDOW_SIZE) {
      return {
        evaluation: { accepted: false, distanceM: 0, reason: "warming-up" },
        sample: null,
      };
    }

    const samples = this.recentSamples;
    const smoothed: GpsSample = {
      latitude: median(samples.map((sample) => sample.latitude)),
      longitude: median(samples.map((sample) => sample.longitude)),
      accuracy: median(samples.map(resolvedAccuracy)),
      speed: median(
        samples
          .map((sample) => sample.speed)
          .filter(
            (speed): speed is number =>
              typeof speed === "number" && Number.isFinite(speed) && speed >= 0,
          ),
      ),
      timestamp: samples.at(-1)?.timestamp ?? next.timestamp,
    };
    const evaluation = evaluateGpsSample(this.lastSmoothedSample, smoothed);
    if (evaluation.accepted) {
      this.lastSmoothedSample = smoothed;
    }
    return { evaluation, sample: evaluation.accepted ? smoothed : null };
  }
}
