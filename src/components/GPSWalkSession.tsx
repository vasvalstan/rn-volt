import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  FadeIn,
  SlideInDown,
} from "react-native-reanimated";
import {
  MapView,
  Camera,
  UserTrackingMode,
  LocationPuck,
  ShapeSource,
  LineLayer,
} from "@rnmapbox/maps";
import type { Position } from "geojson";
import { VOLT_DOODLE_STYLE_URL } from "../lib/voltMapboxDoodleStyle";
import type { GpsMilestone } from "../lib/gpsSession";
import {
  getReachedMilestones,
  getNextMilestone,
  getCurrentRewards,
} from "../lib/gpsSession";

// ─── DESIGN TOKENS (from design.md) ─────────────────
const C = {
  hotPink: "#FF2D78",
  hotPinkLight: "rgba(255,45,120,0.12)",
  mint: "#00E5A0",
  mintLight: "#E0FCF4",
  electricYellow: "#FFD60A",
  black: "#1A1A1A",
  white: "#FFFFFF",
  offWhite: "#F5F5F0",
  muted: "#E5E5E5",
  mutedFg: "#666666",
  socialPink: "#FFEAF2",
  cream: "#FFFCEB",
};

const SH4 = {
  shadowColor: C.black,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 4,
} as const;

const SH2 = {
  shadowColor: C.black,
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 2,
} as const;

const SH8 = {
  shadowColor: C.black,
  shadowOffset: { width: 8, height: 8 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 8,
} as const;

// ─── GPS UTILITIES ───────────────────────────────────

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPace(meters: number, seconds: number): string {
  if (meters < 10 || seconds < 1) return "--:--";
  const kmPerSec = meters / 1000 / seconds;
  const minPerKm = 1 / (kmPerSec * 60);
  const paceMin = Math.floor(minPerKm);
  const paceSec = Math.round((minPerKm - paceMin) * 60);
  return `${paceMin}:${paceSec.toString().padStart(2, "0")}`;
}

// ─── COIN ANIMATION COMPONENT ───────────────────────

interface CoinPopup {
  id: string;
  label: string;
  dp: number;
  minutes: number;
}

function CoinAnimation({ coin, onDone }: Readonly<{ coin: CoinPopup; onDone: () => void }>) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.3, { duration: 200 }),
      withTiming(1, { duration: 150 }),
    );
    translateY.value = withSequence(
      withTiming(-80, { duration: 600 }),
      withDelay(400, withTiming(-120, { duration: 400 })),
    );
    opacity.value = withDelay(
      800,
      withTiming(0, { duration: 400 }),
    );
    const timer = setTimeout(onDone, 1300);
    return () => clearTimeout(timer);
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[s.coinPopup, animStyle]}>
      <View style={s.coinCircle}>
        <MaterialIcons name="paid" size={20} color={C.black} />
      </View>
      <View style={s.coinLabel}>
        <Text style={s.coinFuelText}>+{coin.minutes} MIN FUEL</Text>
        <Text style={s.coinLabelText}>+{coin.dp} DP</Text>
        <Text style={s.coinMilestone}>{coin.label}</Text>
      </View>
    </Animated.View>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────

interface Props {
  /** Distance checkpoints (from onboarding / profile). */
  readonly milestones: GpsMilestone[];
  /** e.g. 5000 for first 5K goal — optional celebration + copy. */
  readonly targetDistanceM: number | null;
  readonly startCta: string;
  readonly summaryTitle: string;
  readonly summarySubtitle?: string;
  /** Shown under stats on the map (reward formula hint). */
  readonly formulaHint?: string;
  readonly onCancel: () => void;
  readonly onComplete: (result: {
    distanceM: number;
    durationSec: number;
    dpEarned: number;
    minutesEarned: number;
    routeCoords: Position[];
  }) => void;
}

type SessionState = "requesting" | "ready" | "tracking" | "paused" | "summary";

export default function GPSWalkSession({
  milestones,
  targetDistanceM,
  startCta,
  summaryTitle,
  summarySubtitle,
  formulaHint,
  onCancel,
  onComplete,
}: Props) {
  const [sessionState, setSessionState] = useState<SessionState>("requesting");
  const [routeCoords, setRouteCoords] = useState<Position[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [coins, setCoins] = useState<CoinPopup[]>([]);
  const [lastMilestoneIndex, setLastMilestoneIndex] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);

  const cameraRef = useRef<Camera>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCoord = useRef<{ lat: number; lon: number } | null>(null);

  // ─── PERMISSIONS ────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== "granted") {
        Alert.alert(
          "Location Required",
          "Volt needs location access to track your walk and reward you with Unlock Minutes.",
          [{ text: "OK", onPress: onCancel }],
        );
        return;
      }
      setSessionState("ready");
    })();
    return () => stopTracking();
  }, []);

  // ─── TIMER ──────────────────────────────────────────
  useEffect(() => {
    if (sessionState === "tracking" && !isPaused) {
      timerRef.current = setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionState, isPaused]);

  // ─── MILESTONE CHECKER ─────────────────────────────
  useEffect(() => {
    const reached = getReachedMilestones(totalDistance, milestones);
    if (reached.length > 0 && reached.length - 1 > lastMilestoneIndex) {
      const newMilestone = reached.at(-1);
      if (!newMilestone) return;
      setLastMilestoneIndex(reached.length - 1);
      const coinId = `coin-${Date.now()}`;
      setCoins((prev) => [
        ...prev,
        {
          id: coinId,
          label: newMilestone.label,
          dp: newMilestone.dp,
          minutes: newMilestone.minutes,
        },
      ]);
    }
  }, [totalDistance, lastMilestoneIndex, milestones]);

  // ─── GPS TRACKING ──────────────────────────────────
  const startTracking = useCallback(async () => {
    setSessionState("tracking");

    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 3,
      },
      (loc) => {
        if (isPaused) return;

        const { latitude, longitude } = loc.coords;
        const newCoord: Position = [longitude, latitude];

        setRouteCoords((prev) => [...prev, newCoord]);

        if (lastCoord.current) {
          const d = haversineDistance(
            lastCoord.current.lat,
            lastCoord.current.lon,
            latitude,
            longitude,
          );
          if (d > 1 && d < 100) {
            setTotalDistance((prev) => prev + d);
          }
        }

        lastCoord.current = { lat: latitude, lon: longitude };
      },
    );

    locationSub.current = sub;
  }, [isPaused]);

  const stopTracking = useCallback(() => {
    locationSub.current?.remove();
    locationSub.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => !prev);
    if (isPaused) {
      setSessionState("tracking");
    } else {
      setSessionState("paused");
    }
  }, [isPaused]);

  const finishSession = useCallback(() => {
    stopTracking();
    setSessionState("summary");
  }, [stopTracking]);

  const confirmFinish = useCallback(() => {
    const rewards = getCurrentRewards(totalDistance, milestones);
    onComplete({
      distanceM: totalDistance,
      durationSec: elapsedSec,
      dpEarned: rewards.dp,
      minutesEarned: rewards.minutes,
      routeCoords,
    });
  }, [totalDistance, elapsedSec, routeCoords, onComplete, milestones]);

  const removeCoin = useCallback((id: string) => {
    setCoins((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // ─── ROUTE GEOJSON ─────────────────────────────────
  const routeGeoJSON = {
    type: "FeatureCollection" as const,
    features:
      routeCoords.length >= 2
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: routeCoords,
              },
              properties: {},
            },
          ]
        : [],
  };

  const rewards = getCurrentRewards(totalDistance, milestones);
  const nextMilestone = getNextMilestone(totalDistance, milestones);
  const targetHit =
    targetDistanceM !== null && targetDistanceM > 0 && totalDistance >= targetDistanceM;
  const progressToNext = nextMilestone
    ? Math.min(
        1,
        totalDistance /
          nextMilestone.distanceM,
      )
    : 1;

  // ─── REQUESTING PERMISSIONS ────────────────────────
  if (sessionState === "requesting") {
    return (
      <View style={s.fullCenter}>
        <View style={s.permCard}>
          <View style={s.permIconWrap}>
            <MaterialIcons name="my-location" size={36} color={C.mint} />
          </View>
          <Text style={s.permTitle}>ENABLING GPS</Text>
          <Text style={s.permSub}>Setting up location tracking...</Text>
        </View>
      </View>
    );
  }

  // ─── SUMMARY SCREEN ───────────────────────────────
  if (sessionState === "summary") {
    return (
      <View style={s.fullCenter}>
        <Animated.View entering={SlideInDown.duration(400)} style={s.summaryCard}>
          <View style={s.summaryBadge}>
            <MaterialIcons name="emoji-events" size={32} color={C.black} />
          </View>
          <Text style={s.summaryTitle}>{summaryTitle}</Text>
          {summarySubtitle ? (
            <Text style={s.summarySub}>{summarySubtitle}</Text>
          ) : null}
          {targetHit && targetDistanceM ? (
            <View style={s.targetHitPill}>
              <MaterialIcons name="flag" size={16} color={C.black} />
              <Text style={s.targetHitText}>
                {(targetDistanceM / 1000).toFixed(0)}KM TARGET HIT
              </Text>
            </View>
          ) : null}

          <View style={s.summaryGrid}>
            <View style={s.summaryStatBox}>
              <Text style={s.summaryStatValue}>
                {formatDistance(totalDistance)}
              </Text>
              <Text style={s.summaryStatLabel}>DISTANCE</Text>
            </View>
            <View style={s.summaryStatBox}>
              <Text style={s.summaryStatValue}>
                {formatDuration(elapsedSec)}
              </Text>
              <Text style={s.summaryStatLabel}>TIME</Text>
            </View>
            <View style={s.summaryStatBox}>
              <Text style={[s.summaryStatValue, { color: C.hotPink }]}>
                {formatPace(totalDistance, elapsedSec)}
              </Text>
              <Text style={s.summaryStatLabel}>PACE /KM</Text>
            </View>
          </View>

          <View style={s.rewardRow}>
            <View style={[s.rewardPill, { backgroundColor: C.electricYellow }]}>
              <MaterialIcons name="paid" size={16} color={C.black} />
              <Text style={s.rewardText}>+{rewards.dp} DP</Text>
            </View>
            <View style={[s.rewardPill, { backgroundColor: C.mintLight }]}>
              <MaterialIcons name="battery-charging-full" size={16} color={C.mint} />
              <Text style={s.rewardText}>+{rewards.minutes} MIN</Text>
            </View>
          </View>

          <Pressable style={s.claimBtn} onPress={confirmFinish}>
            <Text style={s.claimBtnText}>CLAIM REWARDS</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  // ─── MAP SESSION ───────────────────────────────────
  return (
    <View style={s.container}>
      <MapView
        style={s.map}
        styleURL={VOLT_DOODLE_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
      >
        <Camera
          ref={cameraRef}
          followUserLocation={sessionState === "tracking" || sessionState === "ready"}
          followUserMode={UserTrackingMode.FollowWithHeading}
          followZoomLevel={16}
          followPitch={0}
        />

        <LocationPuck
          puckBearingEnabled
          puckBearing="heading"
          pulsing={{
            isEnabled: true,
            color: C.mint,
            radius: 40,
          }}
        />

        {routeCoords.length >= 2 && (
          <ShapeSource id="route-source" shape={routeGeoJSON}>
            {/* Route casing (black outline) */}
            <LineLayer
              id="route-casing"
              style={{
                lineColor: C.black,
                lineWidth: 8,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            {/* Route fill (hotPink) */}
            <LineLayer
              id="route-fill"
              style={{
                lineColor: C.hotPink,
                lineWidth: 5,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      {/* ─── COIN POPUPS ──────────────────────────── */}
      <View style={s.coinContainer} pointerEvents="none">
        {coins.map((coin) => (
          <CoinAnimation
            key={coin.id}
            coin={coin}
            onDone={() => removeCoin(coin.id)}
          />
        ))}
      </View>

      {/* ─── TOP BAR ──────────────────────────────── */}
      <View style={s.topBar}>
        <Pressable style={s.backBtn} onPress={onCancel}>
          <MaterialIcons name="arrow-back" size={22} color={C.black} />
        </Pressable>

        <View style={s.dpPill}>
          <MaterialIcons name="paid" size={14} color={C.electricYellow} />
          <Text style={s.dpPillText}>{rewards.dp}</Text>
        </View>

        <View style={s.fuelPill}>
          <MaterialIcons name="battery-charging-full" size={14} color={C.mint} />
          <Text style={s.fuelPillText}>{rewards.minutes}m</Text>
        </View>
      </View>

      {/* ─── STATS PANEL ─────────────────────────── */}
      <Animated.View entering={FadeIn.duration(300)} style={s.statsPanel}>
        <View style={s.statsRow}>
          <View style={s.statBlock}>
            <Text style={s.statValue}>{formatDistance(totalDistance)}</Text>
            <Text style={s.statLabel}>DISTANCE</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statBlock}>
            <Text style={s.statValue}>{formatDuration(elapsedSec)}</Text>
            <Text style={s.statLabel}>TIME</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statBlock}>
            <Text style={s.statValue}>
              {formatPace(totalDistance, elapsedSec)}
            </Text>
            <Text style={s.statLabel}>PACE</Text>
          </View>
        </View>

        {formulaHint ? (
          <Text style={s.formulaHint} numberOfLines={2}>
            {formulaHint}
          </Text>
        ) : null}
        {targetDistanceM ? (
          <Text style={s.targetHint}>
            GOAL: {(targetDistanceM / 1000).toFixed(0)}km
            {targetHit ? " ✓" : ""}
          </Text>
        ) : null}

        {/* Milestone progress */}
        {nextMilestone && (
          <View style={s.milestoneRow}>
            <Text style={s.milestoneLabel}>
              NEXT: {nextMilestone.label}
            </Text>
            <View style={s.milestoneTrack}>
              <View
                style={[
                  s.milestoneFill,
                  { width: `${Math.round(progressToNext * 100)}%` },
                ]}
              />
            </View>
            <Text style={s.milestoneReward}>+{nextMilestone.dp} DP</Text>
          </View>
        )}
      </Animated.View>

      {/* ─── BOTTOM CONTROLS ─────────────────────── */}
      <View style={s.bottomControls}>
        {sessionState === "ready" && (
          <Pressable style={s.startBtn} onPress={startTracking}>
            <Text style={s.startBtnText}>{startCta}</Text>
          </Pressable>
        )}

        {(sessionState === "tracking" || sessionState === "paused") && (
          <View style={s.controlRow}>
            <Pressable style={s.pauseBtn} onPress={togglePause}>
              <MaterialIcons
                name={isPaused ? "play-arrow" : "pause"}
                size={28}
                color={C.black}
              />
            </Pressable>
            <Pressable style={s.finishBtn} onPress={finishSession}>
              <MaterialIcons name="stop" size={28} color={C.white} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── STYLES ─────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.socialPink },
  map: { flex: 1 },
  fullCenter: {
    flex: 1,
    backgroundColor: C.offWhite,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  // Permission screen
  permCard: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 12,
    ...SH8,
  },
  permIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.mintLight,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH4,
  },
  permTitle: {
    fontSize: 18,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.black,
    textTransform: "uppercase",
  },
  permSub: {
    fontSize: 13,
    fontWeight: "700",
    color: C.mutedFg,
    textAlign: "center",
  },

  // Top bar
  topBar: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 40,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH2,
  },
  dpPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.black,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    ...SH2,
  },
  dpPillText: {
    fontSize: 13,
    fontWeight: "900",
    color: C.white,
  },
  fuelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    ...SH2,
  },
  fuelPillText: {
    fontSize: 13,
    fontWeight: "900",
    color: C.black,
  },

  // Stats panel
  statsPanel: {
    position: "absolute",
    bottom: 130,
    left: 16,
    right: 16,
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 20,
    padding: 16,
    ...SH4,
    zIndex: 10,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statBlock: { flex: 1, alignItems: "center" },
  statValue: {
    fontSize: 22,
    fontWeight: "900",
    color: C.black,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.mutedFg,
    textTransform: "uppercase",
    marginTop: 2,
  },
  statDivider: {
    width: 2,
    height: 30,
    backgroundColor: C.muted,
    borderRadius: 1,
  },
  formulaHint: {
    fontSize: 10,
    fontWeight: "700",
    color: C.mutedFg,
    textAlign: "center",
    marginTop: 10,
    paddingHorizontal: 4,
  },
  targetHint: {
    fontSize: 11,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.hotPink,
    textAlign: "center",
    marginTop: 6,
    textTransform: "uppercase",
  },
  milestoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: C.muted,
  },
  milestoneLabel: {
    fontSize: 9,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.mutedFg,
    textTransform: "uppercase",
    width: 52,
  },
  milestoneTrack: {
    flex: 1,
    height: 12,
    backgroundColor: C.muted,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.black,
    overflow: "hidden",
  },
  milestoneFill: {
    height: "100%",
    backgroundColor: C.mint,
    borderRadius: 5,
  },
  milestoneReward: {
    fontSize: 10,
    fontWeight: "900",
    color: C.electricYellow,
    width: 48,
    textAlign: "right",
  },

  // Bottom controls
  bottomControls: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 44 : 24,
    left: 24,
    right: 24,
    alignItems: "center",
    zIndex: 10,
  },
  startBtn: {
    width: "100%",
    height: 56,
    backgroundColor: C.mint,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    ...SH4,
  },
  startBtnText: {
    fontSize: 18,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.black,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  controlRow: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
  },
  pauseBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH4,
  },
  finishBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.hotPink,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH4,
  },

  // Coin popups
  coinContainer: {
    position: "absolute",
    top: "40%",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
  },
  coinPopup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...SH4,
    marginBottom: 8,
  },
  coinCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.electricYellow,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH2,
  },
  coinLabel: { gap: 2 },
  coinFuelText: {
    fontSize: 12,
    fontWeight: "900",
    color: C.black,
    textTransform: "uppercase",
  },
  coinLabelText: {
    fontSize: 16,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.black,
  },
  coinMilestone: {
    fontSize: 9,
    fontWeight: "900",
    color: C.mutedFg,
    textTransform: "uppercase",
  },

  // Summary screen
  summaryCard: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    gap: 20,
    width: "100%",
    ...SH8,
  },
  summaryBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.electricYellow,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH4,
  },
  summaryTitle: {
    fontSize: 24,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.black,
    textTransform: "uppercase",
    letterSpacing: -0.5,
  },
  summarySub: {
    fontSize: 13,
    fontWeight: "700",
    color: C.mutedFg,
    textAlign: "center",
    marginTop: -8,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  targetHitPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.mint,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...SH2,
  },
  targetHitText: {
    fontSize: 11,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.black,
    textTransform: "uppercase",
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  summaryStatBox: {
    flex: 1,
    backgroundColor: C.offWhite,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
    ...SH2,
  },
  summaryStatValue: {
    fontSize: 18,
    fontWeight: "900",
    color: C.black,
  },
  summaryStatLabel: {
    fontSize: 8,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.mutedFg,
    textTransform: "uppercase",
    marginTop: 4,
  },
  rewardRow: {
    flexDirection: "row",
    gap: 12,
  },
  rewardPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...SH2,
  },
  rewardText: {
    fontSize: 14,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.black,
  },
  claimBtn: {
    width: "100%",
    height: 56,
    backgroundColor: C.hotPink,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    ...SH4,
  },
  claimBtnText: {
    fontSize: 18,
    fontWeight: "900",
    fontStyle: "italic",
    color: C.black,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
});
