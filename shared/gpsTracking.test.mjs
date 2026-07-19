import assert from "node:assert/strict";
import {
  evaluateGpsSample,
  GpsDistanceTracker,
  haversineDistance,
  MAX_GPS_ACCURACY_METRES,
} from "./gpsTracking.ts";

const origin = {
  latitude: 51.5074,
  longitude: -0.1278,
  accuracy: 5,
  speed: 0,
  timestamp: 1_000,
};

assert.equal(evaluateGpsSample(null, origin).accepted, true);
assert.ok(
  haversineDistance(51.5074, -0.1278, 51.5074, -0.12635) > 99,
  "distance helper should return real-world metres",
);

assert.deepEqual(
  evaluateGpsSample(origin, {
    ...origin,
    accuracy: MAX_GPS_ACCURACY_METRES + 1,
    timestamp: 2_000,
  }),
  { accepted: false, distanceM: 0, reason: "poor-accuracy" },
);

assert.deepEqual(
  evaluateGpsSample(origin, {
    ...origin,
    longitude: origin.longitude + 0.000005,
    timestamp: 3_000,
  }),
  { accepted: false, distanceM: 0, reason: "stationary-jitter" },
);

assert.deepEqual(
  evaluateGpsSample(origin, {
    ...origin,
    longitude: origin.longitude + 0.002,
    timestamp: 11_000,
  }),
  { accepted: false, distanceM: 0, reason: "implausible-jump" },
);

assert.deepEqual(
  evaluateGpsSample(origin, {
    ...origin,
    longitude: origin.longitude + 0.0002,
    timestamp: 1_500,
  }),
  { accepted: false, distanceM: 0, reason: "implausible-speed" },
);

const walkingSample = evaluateGpsSample(origin, {
  ...origin,
  longitude: origin.longitude + 0.0002,
  speed: 1.4,
  timestamp: 6_000,
});
assert.equal(walkingSample.accepted, true);
if (walkingSample.accepted) {
  assert.ok(walkingSample.distanceM > 10 && walkingSample.distanceM < 20);
}

const tracker = new GpsDistanceTracker();
const locationAt = (metres, timestamp) => ({
  ...origin,
  longitude:
    origin.longitude +
    metres / (111_320 * Math.cos((origin.latitude * Math.PI) / 180)),
  timestamp,
});

assert.equal(tracker.add(locationAt(0, 1_000)).evaluation.reason, "warming-up");
assert.equal(tracker.add(locationAt(3, 3_000)).evaluation.reason, "warming-up");
assert.deepEqual(tracker.add(locationAt(6, 5_000)).evaluation, {
  accepted: true,
  distanceM: 0,
});

// A single seven-metre GPS wobble is medianed out instead of being rewarded.
assert.equal(tracker.add(locationAt(13, 7_000)).evaluation.reason, "stationary-jitter");
assert.equal(tracker.add(locationAt(6, 9_000)).evaluation.reason, "stationary-jitter");

const walkingTracker = new GpsDistanceTracker();
for (let index = 0; index < 3; index += 1) {
  walkingTracker.add(locationAt(index * 3, 1_000 + index * 2_000));
}
let trackedDistance = 0;
for (let index = 3; index < 9; index += 1) {
  const result = walkingTracker.add(locationAt(index * 3, 1_000 + index * 2_000));
  trackedDistance += result.evaluation.distanceM;
}
assert.ok(trackedDistance > 10 && trackedDistance < 30, "steady walking should accumulate conservatively");

console.log("GPS tracking checks passed");
