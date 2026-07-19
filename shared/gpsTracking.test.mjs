import assert from "node:assert/strict";
import {
  evaluateGpsSample,
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
  longitude: origin.longitude + 0.0001,
  speed: 1.4,
  timestamp: 6_000,
});
assert.equal(walkingSample.accepted, true);
if (walkingSample.accepted) {
  assert.ok(walkingSample.distanceM > 5 && walkingSample.distanceM < 10);
}

console.log("GPS tracking checks passed");
