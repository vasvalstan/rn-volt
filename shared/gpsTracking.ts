// A coin or reward must not be earned from a broad, low-confidence location fix.
// Fifteen metres is a deliberate trade-off: it is achievable outdoors on modern
// phones while rejecting the noisy fixes that cause distance to drift at rest.
export const MAX_GPS_ACCURACY_METRES = 15;
export const MAX_GPS_SPEED_METRES_PER_SECOND = 12;
export const MAX_GPS_SEGMENT_METRES = 100;
export const GPS_WARM_UP_SAMPLE_COUNT = 3;
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

/**
 * Converts raw location fixes into a conservative, rewarded route.
 *
 * We wait for three good fixes before starting the route, then preserve the
 * original points. That avoids cutting legitimate corners while the accuracy
 * and minimum-segment checks keep a one-off GPS wobble from adding distance.
 */
export class GpsDistanceTracker {
  private goodSampleCount = 0;
  private lastFixTimestamp: number | null = null;
  private lastAcceptedSample: GpsSample | null = null;

  reset(): void {
    this.goodSampleCount = 0;
    this.lastFixTimestamp = null;
    this.lastAcceptedSample = null;
  }

  add(next: GpsSample): { evaluation: GpsSampleEvaluation; sample: GpsSample | null } {
    const qualityEvaluation = evaluateGpsSample(null, next);
    if (!qualityEvaluation.accepted) {
      return { evaluation: qualityEvaluation, sample: null };
    }

    if (this.lastFixTimestamp !== null && next.timestamp <= this.lastFixTimestamp) {
      return {
        evaluation: { accepted: false, distanceM: 0, reason: "stale-sample" },
        sample: null,
      };
    }
    if (
      this.lastFixTimestamp !== null &&
      next.timestamp - this.lastFixTimestamp > 10_000
    ) {
      // A long pause needs a fresh lock; do not bridge it with a GPS segment.
      this.goodSampleCount = 0;
      this.lastAcceptedSample = null;
    }
    this.lastFixTimestamp = next.timestamp;
    this.goodSampleCount += 1;
    if (this.goodSampleCount < GPS_WARM_UP_SAMPLE_COUNT) {
      return {
        evaluation: { accepted: false, distanceM: 0, reason: "warming-up" },
        sample: null,
      };
    }

    const evaluation = evaluateGpsSample(this.lastAcceptedSample, next);
    if (evaluation.accepted) {
      this.lastAcceptedSample = next;
    }
    return { evaluation, sample: evaluation.accepted ? next : null };
  }
}
