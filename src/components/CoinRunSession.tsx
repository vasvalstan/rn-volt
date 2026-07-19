import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { MaterialIcons } from "@react-native-vector-icons/material-icons";
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
import { type EconomyProfile } from "../lib/economyEngine";
import { CoinIcon } from "./CoinChip";
import { computeActivityReward } from "../../shared/gamification";
import {
  GpsDistanceTracker,
  type GpsSample,
} from "../../shared/gpsTracking";

const C = {
  hotPink: "#FF2D78",
  mint: "#00E5A0",
  mintLight: "#E0FCF4",
  electricYellow: "#FFD60A",
  black: "#1A1A1A",
  white: "#FFFFFF",
  offWhite: "#F5F5F0",
  muted: "#E5E5E5",
  mutedFg: "#666666",
  socialPink: "#FFEAF2",
};

const SH4 = { shadowColor: C.black, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 } as const;
const SH2 = { shadowColor: C.black, shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0, elevation: 2 } as const;
const SH8 = { shadowColor: C.black, shadowOffset: { width: 8, height: 8 }, shadowOpacity: 1, shadowRadius: 0, elevation: 8 } as const;

const CHECKPOINT_INTERVAL_M = 250;

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPace(meters: number, seconds: number): string {
  if (meters < 10 || seconds < 1) return "--:--";
  const minPerKm = seconds / 60 / (meters / 1000);
  const paceMin = Math.floor(minPerKm);
  const paceSec = Math.round((minPerKm - paceMin) * 60);
  return `${paceMin}:${paceSec.toString().padStart(2, "0")}`;
}

// ─── COIN DROP ANIMATION ────────────────────────────

interface CoinDrop {
  id: string;
  coins: number;
  vp: number;
  label: string;
}

function CoinDropAnimation({
  drop,
  onDone,
}: Readonly<{
  drop: CoinDrop;
  onDone: (id: string) => void;
}>) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.set(withSequence(
      withTiming(1.4, { duration: 180 }),
      withTiming(1, { duration: 140 }),
    ));
    translateY.set(withSequence(
      withTiming(-90, { duration: 500 }),
      withDelay(500, withTiming(-130, { duration: 400 })),
    ));
    opacity.set(withDelay(800, withTiming(0, { duration: 400 })));
    const timer = setTimeout(() => onDone(drop.id), 1300);
    return () => clearTimeout(timer);
  }, [drop.id, onDone, opacity, scale, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }, { scale: scale.get() }],
    opacity: opacity.get(),
  }));

  return (
    <Animated.View style={[st.coinPopup, animStyle]}>
      <View style={st.coinCircle}>
        <CoinIcon size={22} />
      </View>
      <View style={{ gap: 2 }}>
        <Text style={st.coinMainText}>+{drop.coins} COINS</Text>
        <Text style={st.coinVpText}>+{drop.vp} VP</Text>
        <Text style={st.coinLabelText}>{drop.label}</Text>
      </View>
    </Animated.View>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────

interface CoinRunProps {
  readonly economyProfile: EconomyProfile;
  readonly onCancel: () => void;
  readonly onComplete: (result: {
    distanceM: number;
    durationSec: number;
    coinsEarned: number;
    vpEarned: number;
    routeCoords: Position[];
  }) => void;
}

type SessionState = "requesting" | "ready" | "tracking" | "paused" | "summary";

export default function CoinRunSession({ economyProfile, onCancel, onComplete }: CoinRunProps) {
  const [sessionState, setSessionState] = useState<SessionState>("requesting");
  const [routeCoords, setRouteCoords] = useState<Position[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [totalCoins, setTotalCoins] = useState(0);
  const [totalVp, setTotalVp] = useState(0);
  const [drops, setDrops] = useState<CoinDrop[]>([]);
  const [lastCheckpointCount, setLastCheckpointCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const cameraRef = useRef<Camera>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStartedAtRef = useRef<number | null>(null);
  const accumulatedElapsedMsRef = useRef(0);
  const gpsTracker = useRef(new GpsDistanceTracker());
  const isPausedRef = useRef(false);
  const totalDistanceRef = useRef(0);
  const lastCheckpointCountRef = useRef(0);
  const trackingRequestRef = useRef(0);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const stopTracking = useCallback(() => {
    trackingRequestRef.current += 1;
    locationSub.current?.remove();
    locationSub.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const syncElapsedClock = useCallback(() => {
    const activeElapsedMs =
      activeStartedAtRef.current === null
        ? 0
        : Math.max(0, Date.now() - activeStartedAtRef.current);
    const nextElapsedSec = Math.floor(
      (accumulatedElapsedMsRef.current + activeElapsedMs) / 1000,
    );
    setElapsedSec(nextElapsedSec);
    return nextElapsedSec;
  }, []);

  const pauseElapsedClock = useCallback(() => {
    if (activeStartedAtRef.current !== null) {
      accumulatedElapsedMsRef.current += Math.max(
        0,
        Date.now() - activeStartedAtRef.current,
      );
      activeStartedAtRef.current = null;
    }
    return syncElapsedClock();
  }, [syncElapsedClock]);

  // ─── PERMISSIONS ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          Alert.alert("Location Required", "Volt needs location access to track your Coin Run.", [{ text: "OK", onPress: () => onCancelRef.current() }]);
          return;
        }
        setSessionState("ready");
      } catch {
        if (cancelled) return;
        Alert.alert(
          "Location Unavailable",
          "Volt could not check location access. Check Location Services and try again.",
          [{ text: "OK", onPress: () => onCancelRef.current() }],
        );
      }
    })();
    return () => {
      cancelled = true;
      stopTracking();
    };
  }, [stopTracking]);

  // ─── TIMER ────────────────────────────────────────
  useEffect(() => {
    if (sessionState === "tracking" && !isPaused) {
      timerRef.current = setInterval(syncElapsedClock, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPaused, sessionState, syncElapsedClock]);

  // ─── GPS TRACKING ─────────────────────────────────
  const startTracking = useCallback(async () => {
    const requestId = trackingRequestRef.current + 1;
    trackingRequestRef.current = requestId;
    isPausedRef.current = false;
    setIsPaused(false);
    gpsTracker.current.reset();
    accumulatedElapsedMsRef.current = 0;
    activeStartedAtRef.current = Date.now();
    setElapsedSec(0);
    setSessionState("tracking");
    try {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 3 },
        (loc) => {
          if (
            trackingRequestRef.current !== requestId ||
            isPausedRef.current
          ) {
            return;
          }
          const sample: GpsSample = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            speed: loc.coords.speed,
            timestamp: loc.timestamp,
          };
          const tracked = gpsTracker.current.add(sample);
          if (!tracked.evaluation.accepted || !tracked.sample) return;
          const evaluation = tracked.evaluation;
          const smoothedSample = tracked.sample;

          setRouteCoords((prev) => [
            ...prev,
            [smoothedSample.longitude, smoothedSample.latitude],
          ]);

          if (evaluation.distanceM > 0) {
            const nextDistance =
              totalDistanceRef.current + evaluation.distanceM;
            totalDistanceRef.current = nextDistance;
            setTotalDistance(nextDistance);

            const checkpoints = Math.floor(nextDistance / CHECKPOINT_INTERVAL_M);
            if (checkpoints > lastCheckpointCountRef.current) {
              const previousReward = computeActivityReward(
                economyProfile,
                "coin_run",
                {
                  distance:
                    lastCheckpointCountRef.current * CHECKPOINT_INTERVAL_M,
                },
              );
              const checkpointReward = computeActivityReward(
                economyProfile,
                "coin_run",
                { distance: checkpoints * CHECKPOINT_INTERVAL_M },
              );
              const earnedCoins =
                checkpointReward.coins - previousReward.coins;
              const earnedVp = checkpointReward.vp - previousReward.vp;
              lastCheckpointCountRef.current = checkpoints;
              setLastCheckpointCount(checkpoints);
              setTotalCoins(checkpointReward.coins);
              setTotalVp(checkpointReward.vp);
              if (earnedCoins > 0 || earnedVp > 0) {
                setDrops((prev) => [
                  ...prev,
                  {
                    id: `drop-${Date.now()}`,
                    coins: earnedCoins,
                    vp: earnedVp,
                    label: checkpoints * CHECKPOINT_INTERVAL_M >= 1000
                      ? `${(checkpoints * CHECKPOINT_INTERVAL_M / 1000).toFixed(1)}km`
                      : `${checkpoints * CHECKPOINT_INTERVAL_M}m`,
                  },
                ]);
              }
            }
          }
        },
      );
      if (trackingRequestRef.current !== requestId) {
        sub.remove();
        return;
      }
      locationSub.current = sub;
    } catch {
      if (trackingRequestRef.current === requestId) {
        activeStartedAtRef.current = null;
        accumulatedElapsedMsRef.current = 0;
        setElapsedSec(0);
        setSessionState("ready");
        Alert.alert(
          "GPS Unavailable",
          "Volt could not start location tracking. Check location services and try again.",
        );
      }
    }
  }, [economyProfile]);

  const togglePause = useCallback(() => {
    const nextPaused = !isPausedRef.current;
    isPausedRef.current = nextPaused;
    setIsPaused(nextPaused);
    setSessionState(nextPaused ? "paused" : "tracking");
    if (nextPaused) {
      pauseElapsedClock();
    } else {
      activeStartedAtRef.current = Date.now();
      gpsTracker.current.reset();
    }
  }, [pauseElapsedClock]);

  const canFinishForReward = totalDistance >= CHECKPOINT_INTERVAL_M;

  const finishSession = useCallback(() => {
    if (!canFinishForReward) {
      Alert.alert(
        "Keep moving",
        `${Math.ceil(CHECKPOINT_INTERVAL_M - totalDistance)}m to your first coin checkpoint.`,
      );
      return;
    }
    pauseElapsedClock();
    stopTracking();
    setSessionState("summary");
  }, [
    canFinishForReward,
    pauseElapsedClock,
    stopTracking,
    totalDistance,
  ]);

  const handleCancel = useCallback(() => {
    if (sessionState !== "tracking" && sessionState !== "paused") {
      onCancel();
      return;
    }
    Alert.alert(
      "End this Coin Run?",
      "Your unclaimed distance and coins will be discarded.",
      [
        { text: "Keep going", style: "cancel" },
        {
          text: "End session",
          style: "destructive",
          onPress: () => {
            stopTracking();
            onCancel();
          },
        },
      ],
    );
  }, [onCancel, sessionState, stopTracking]);

  const confirmFinish = useCallback(() => {
    onComplete({ distanceM: totalDistance, durationSec: elapsedSec, coinsEarned: totalCoins, vpEarned: totalVp, routeCoords });
  }, [totalDistance, elapsedSec, totalCoins, totalVp, routeCoords, onComplete]);

  const removeDrop = useCallback((id: string) => {
    setDrops((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const routeGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: routeCoords.length >= 2
        ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: routeCoords }, properties: {} }]
        : [],
    }),
    [routeCoords],
  );

  const nextCheckpointM = (lastCheckpointCount + 1) * CHECKPOINT_INTERVAL_M;
  const progressToNext = Math.min(1, (totalDistance % CHECKPOINT_INTERVAL_M) / CHECKPOINT_INTERVAL_M);
  const nextCheckpointReward = computeActivityReward(
    economyProfile,
    "coin_run",
    { distance: nextCheckpointM },
  );
  const currentCheckpointReward = computeActivityReward(
    economyProfile,
    "coin_run",
    { distance: lastCheckpointCount * CHECKPOINT_INTERVAL_M },
  );
  const nextCoins =
    nextCheckpointReward.coins - currentCheckpointReward.coins;

  // ─── REQUESTING ───────────────────────────────────
  if (sessionState === "requesting") {
    return (
      <View style={st.fullCenter}>
        <View style={st.permCard}>
          <View style={st.permIconWrap}>
            <MaterialIcons name="my-location" size={36} color={C.mint} />
          </View>
          <Text style={st.permTitle}>COIN RUN</Text>
          <Text style={st.permSub}>Setting up GPS tracking...</Text>
        </View>
      </View>
    );
  }

  // ─── SUMMARY ──────────────────────────────────────
  if (sessionState === "summary") {
    return (
      <View style={st.fullCenter}>
        <Animated.View entering={SlideInDown.duration(400)} style={st.summaryCard}>
          <View style={st.summaryBadge}>
            <CoinIcon size={28} />
          </View>
          <Text style={st.summaryTitle}>COIN RUN COMPLETE!</Text>
          <Text style={st.summarySub}>Great run! Claim your loot below.</Text>

          <View style={st.summaryGrid}>
            <View style={st.summaryStatBox}>
              <Text style={[st.summaryStatValue, { color: C.electricYellow }]}>{totalCoins}</Text>
              <Text style={st.summaryStatLabel}>COINS</Text>
            </View>
            <View style={st.summaryStatBox}>
              <Text style={[st.summaryStatValue, { color: C.hotPink }]}>{totalVp}</Text>
              <Text style={st.summaryStatLabel}>VP</Text>
            </View>
            <View style={st.summaryStatBox}>
              <Text style={st.summaryStatValue}>{formatDistance(totalDistance)}</Text>
              <Text style={st.summaryStatLabel}>DISTANCE</Text>
            </View>
          </View>

          <View style={st.summaryGrid}>
            <View style={st.summaryStatBox}>
              <Text style={st.summaryStatValue}>{formatPace(totalDistance, elapsedSec)}</Text>
              <Text style={st.summaryStatLabel}>PACE /KM</Text>
            </View>
            <View style={st.summaryStatBox}>
              <Text style={st.summaryStatValue}>{formatDuration(elapsedSec)}</Text>
              <Text style={st.summaryStatLabel}>TIME</Text>
            </View>
          </View>

          <Pressable style={st.claimBtn} onPress={confirmFinish}>
            <Text style={st.claimBtnText}>CLAIM REWARDS</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  // ─── MAP SESSION ──────────────────────────────────
  return (
    <View style={st.container}>
      <MapView
        style={st.map}
        styleURL={VOLT_DOODLE_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
      >
        <Camera
          ref={cameraRef}
          followUserLocation={
            Platform.OS !== "web" &&
            (sessionState === "tracking" || sessionState === "ready")
          }
          followUserMode={
            Platform.OS === "web"
              ? undefined
              : UserTrackingMode.FollowWithHeading
          }
          followZoomLevel={16}
          followPitch={0}
        />
        {Platform.OS !== "web" ? (
          <LocationPuck puckBearingEnabled puckBearing="heading" pulsing={{ isEnabled: true, color: C.electricYellow, radius: 40 }} />
        ) : null}

        {Platform.OS !== "web" && routeCoords.length >= 2 ? (
          <ShapeSource id="coin-route-source" shape={routeGeoJSON}>
            <LineLayer id="coin-route-casing" style={{ lineColor: C.black, lineWidth: 8, lineCap: "round", lineJoin: "round" }} />
            <LineLayer id="coin-route-fill" style={{ lineColor: C.electricYellow, lineWidth: 5, lineCap: "round", lineJoin: "round" }} />
          </ShapeSource>
        ) : null}
      </MapView>

      {/* Coin drop popups */}
      <View style={st.coinContainer} pointerEvents="none">
        {drops.map((drop) => (
          <CoinDropAnimation key={drop.id} drop={drop} onDone={removeDrop} />
        ))}
      </View>

      {/* Top bar */}
      <View style={st.topBar}>
        <Pressable style={st.backBtn} onPress={handleCancel}>
          <MaterialIcons name="arrow-back" size={22} color={C.black} />
        </Pressable>
        <View style={st.coinPill}>
          <CoinIcon size={16} />
          <Text style={st.coinPillText}>{totalCoins}</Text>
        </View>
        <View style={st.vpPill}>
          <MaterialIcons name="bolt" size={14} color={C.hotPink} />
          <Text style={st.vpPillText}>{totalVp} VP</Text>
        </View>
      </View>

      {/* Stats panel */}
      <Animated.View entering={FadeIn.duration(300)} style={st.statsPanel}>
        <View style={st.statsRow}>
          <View style={st.statBlock}>
            <Text style={st.statValue}>{formatDistance(totalDistance)}</Text>
            <Text style={st.statLabel}>DISTANCE</Text>
          </View>
          <View style={st.statDivider} />
          <View style={st.statBlock}>
            <Text style={st.statValue}>{formatDuration(elapsedSec)}</Text>
            <Text style={st.statLabel}>TIME</Text>
          </View>
          <View style={st.statDivider} />
          <View style={st.statBlock}>
            <Text style={st.statValue}>{formatPace(totalDistance, elapsedSec)}</Text>
            <Text style={st.statLabel}>PACE</Text>
          </View>
        </View>

        {/* Next coin checkpoint progress */}
        <View style={st.checkpointRow}>
          <Text style={st.checkpointLabel}>NEXT: {nextCheckpointM >= 1000 ? `${(nextCheckpointM / 1000).toFixed(1)}km` : `${nextCheckpointM}m`}</Text>
          <View style={st.checkpointTrack}>
            <View style={[st.checkpointFill, { width: `${Math.round(progressToNext * 100)}%` }]} />
          </View>
          <View style={st.checkpointRewardRow}>
            <CoinIcon size={16} />
            <Text style={st.checkpointReward}>+{nextCoins}</Text>
          </View>
        </View>
      </Animated.View>

      {/* Bottom controls */}
      <View style={st.bottomControls}>
        {sessionState === "ready" && (
          <Pressable style={st.startBtn} onPress={startTracking}>
            <MaterialIcons name="directions-run" size={22} color={C.black} />
            <Text style={st.startBtnText}>START COIN RUN</Text>
          </Pressable>
        )}

        {(sessionState === "tracking" || sessionState === "paused") && (
          <View style={st.controlRow}>
            <Pressable style={st.pauseBtn} onPress={togglePause}>
              <MaterialIcons name={isPaused ? "play-arrow" : "pause"} size={28} color={C.black} />
            </Pressable>
            <Pressable
              style={[
                st.finishBtn,
                !canFinishForReward ? st.controlDisabled : undefined,
              ]}
              onPress={finishSession}
              accessibilityRole="button"
              accessibilityLabel={
                canFinishForReward
                  ? "Finish Coin Run"
                  : `${Math.ceil(CHECKPOINT_INTERVAL_M - totalDistance)} metres to first coin checkpoint`
              }
            >
              <MaterialIcons name="stop" size={28} color={C.white} />
            </Pressable>
          </View>
        )}
        {(sessionState === "tracking" || sessionState === "paused") &&
        !canFinishForReward ? (
          <Text style={st.minimumDistanceHint}>
            {Math.ceil(CHECKPOINT_INTERVAL_M - totalDistance)}m TO FIRST COINS
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.socialPink },
  map: { flex: 1 },
  fullCenter: { flex: 1, backgroundColor: C.offWhite, alignItems: "center", justifyContent: "center", padding: 24 },

  permCard: { backgroundColor: C.white, borderWidth: 2, borderColor: C.black, borderRadius: 20, padding: 32, alignItems: "center", gap: 12, ...SH8 },
  permIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.mintLight, borderWidth: 2, borderColor: C.black, alignItems: "center", justifyContent: "center", ...SH4 },
  permTitle: { fontSize: 18, fontWeight: "900", fontStyle: "italic", color: C.black, textTransform: "uppercase" },
  permSub: { fontSize: 13, fontWeight: "700", color: C.mutedFg, textAlign: "center" },

  topBar: { position: "absolute", top: Platform.OS === "ios" ? 56 : 40, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 8, zIndex: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.white, borderWidth: 2, borderColor: C.black, alignItems: "center", justifyContent: "center", ...SH2 },
  coinPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.electricYellow, borderWidth: 2, borderColor: C.black, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, ...SH2 },
  coinPillText: { fontSize: 14, fontWeight: "900", color: C.black },
  vpPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.black, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, ...SH2 },
  vpPillText: { fontSize: 13, fontWeight: "900", color: C.white },

  statsPanel: { position: "absolute", bottom: 130, left: 16, right: 16, backgroundColor: C.white, borderWidth: 2, borderColor: C.black, borderRadius: 20, padding: 16, ...SH4, zIndex: 10 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statBlock: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "900", color: C.black, letterSpacing: -0.5 },
  statLabel: { fontSize: 9, fontWeight: "900", fontStyle: "italic", color: C.mutedFg, textTransform: "uppercase", marginTop: 2 },
  statDivider: { width: 2, height: 30, backgroundColor: C.muted, borderRadius: 1 },

  checkpointRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 2, borderTopColor: C.muted },
  checkpointLabel: { fontSize: 9, fontWeight: "900", fontStyle: "italic", color: C.mutedFg, textTransform: "uppercase", width: 52 },
  checkpointTrack: { flex: 1, height: 12, backgroundColor: C.muted, borderRadius: 6, borderWidth: 1.5, borderColor: C.black, overflow: "hidden" },
  checkpointFill: { height: "100%", backgroundColor: C.electricYellow, borderRadius: 5 },
  checkpointRewardRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, width: 72 },
  checkpointReward: { fontSize: 10, fontWeight: "900", width: 48, textAlign: "right" },

  bottomControls: { position: "absolute", bottom: Platform.OS === "ios" ? 44 : 24, left: 24, right: 24, alignItems: "center", zIndex: 10 },
  startBtn: { width: "100%", height: 56, backgroundColor: C.electricYellow, borderWidth: 2, borderColor: C.black, borderRadius: 28, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, ...SH4 },
  startBtnText: { fontSize: 18, fontWeight: "900", fontStyle: "italic", color: C.black, textTransform: "uppercase", letterSpacing: 1 },
  controlRow: { flexDirection: "row", gap: 16, alignItems: "center" },
  pauseBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.white, borderWidth: 2, borderColor: C.black, alignItems: "center", justifyContent: "center", ...SH4 },
  finishBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.hotPink, borderWidth: 2, borderColor: C.black, alignItems: "center", justifyContent: "center", ...SH4 },
  controlDisabled: { opacity: 0.55 },
  minimumDistanceHint: { marginTop: 10, color: C.black, fontSize: 11, fontWeight: "900", textAlign: "center" },

  coinContainer: { position: "absolute", top: "38%", left: 0, right: 0, alignItems: "center", zIndex: 20 },
  coinPopup: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.white, borderWidth: 2, borderColor: C.black, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, ...SH4, marginBottom: 8 },
  coinCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.electricYellow, borderWidth: 2, borderColor: C.black, alignItems: "center", justifyContent: "center", ...SH2 },
  coinMainText: { fontSize: 16, fontWeight: "900", fontStyle: "italic", color: C.black },
  coinVpText: { fontSize: 12, fontWeight: "900", color: C.hotPink },
  coinLabelText: { fontSize: 9, fontWeight: "900", color: C.mutedFg, textTransform: "uppercase" },

  summaryCard: { backgroundColor: C.white, borderWidth: 2, borderColor: C.black, borderRadius: 24, padding: 28, alignItems: "center", gap: 20, width: "100%", ...SH8 },
  summaryBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.electricYellow, borderWidth: 2, borderColor: C.black, alignItems: "center", justifyContent: "center", ...SH4 },
  summaryTitle: { fontSize: 22, fontWeight: "900", fontStyle: "italic", color: C.black, textTransform: "uppercase", letterSpacing: -0.5 },
  summarySub: { fontSize: 13, fontWeight: "700", color: C.mutedFg, textAlign: "center", marginTop: -8, paddingHorizontal: 8 },
  summaryGrid: { flexDirection: "row", gap: 10, width: "100%" },
  summaryStatBox: { flex: 1, backgroundColor: C.offWhite, borderWidth: 2, borderColor: C.black, borderRadius: 16, padding: 12, alignItems: "center", ...SH2 },
  summaryStatValue: { fontSize: 18, fontWeight: "900", color: C.black },
  summaryStatLabel: { fontSize: 8, fontWeight: "900", fontStyle: "italic", color: C.mutedFg, textTransform: "uppercase", marginTop: 4 },
  claimBtn: { width: "100%", height: 56, backgroundColor: C.electricYellow, borderWidth: 2, borderColor: C.black, borderRadius: 28, alignItems: "center", justifyContent: "center", ...SH4 },
  claimBtnText: { fontSize: 18, fontWeight: "900", fontStyle: "italic", color: C.black, textTransform: "uppercase", letterSpacing: 1 },
});
