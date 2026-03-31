import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, Alert, Linking } from "react-native";
import { Image } from "expo-image";
import * as Location from "expo-location";
import { MapView, Camera, UserTrackingMode, LocationPuck, MarkerView } from "@rnmapbox/maps";
import { MaterialIcons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { VOLT_DOODLE_STYLE_URL } from "../lib/voltMapboxDoodleStyle";

const C = {
  hotPink: "#FF2D78",
  mint: "#00E5A0",
  electricYellow: "#FFD60A",
  black: "#1A1A1A",
  white: "#FFFFFF",
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

/** Default map center (San Francisco) when location is off — same family as Mapbox demos. */
const DEFAULT_CENTER: [number, number] = [-122.4194, 37.7749];

/**
 * Offset [lng, lat] by `distanceM` meters at `bearingDeg` (0 = north, 90 = east).
 */
function offsetMeters(lat: number, lng: number, distanceM: number, bearingDeg: number): [number, number] {
  const brng = (bearingDeg * Math.PI) / 180;
  const R = 6378137;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angDist = distanceM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

export type SocialMapScreenProps = {
  readonly headerLeft: ReactNode;
  readonly topInset: number;
  readonly bottomInset: number;
  readonly onPressLeaderboard: () => void;
  /** Avatar image URL (remote) or use a fallback from parent. */
  readonly avatarUrl: string;
  readonly speechText: string;
  /** Find-friends card (or any footer); positioned above bottom nav. */
  readonly footerCard: ReactNode;
};

/**
 * Social tab map: real GPS + Volt doodle-styled Mapbox, nearby DP coin markers, leaderboard switch.
 * Matches product-brainstorm “Social Map” (GPS social view, coins, find friends).
 */
export default function SocialMapScreen({
  headerLeft,
  topInset,
  bottomInset,
  onPressLeaderboard,
  avatarUrl,
  speechText,
  footerCard,
}: SocialMapScreenProps) {
  const cameraRef = useRef<Camera>(null);

  const bounce = useSharedValue(0);
  useEffect(() => {
    bounce.value = withRepeat(withTiming(-8, { duration: 750 }), -1, true);
  }, [bounce]);

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bounce.value }],
  }));

  const [locationGranted, setLocationGranted] = useState(false);
  const [userCoord, setUserCoord] = useState<[number, number] | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;
      setLocationGranted(true);
      const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserCoord([first.coords.longitude, first.coords.latitude]);
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 20,
          timeInterval: 8000,
        },
        (loc) => {
          setUserCoord([loc.coords.longitude, loc.coords.latitude]);
        },
      );
    })();
    return () => {
      sub?.remove();
    };
  }, []);

  const mapCenter = userCoord ?? DEFAULT_CENTER;
  const [lng, lat] = mapCenter;

  const coinCoords = useMemo(() => {
    const pairs: readonly [number, number][] = [
      [25, 108],
      [115, 125],
      [205, 92],
      [295, 118],
    ];
    return pairs.map(([bearingDeg, distanceM], i) => ({
      id: `social-coin-${i}`,
      coordinate: offsetMeters(lat, lng, distanceM, bearingDeg),
    }));
  }, [lat, lng]);

  const handleMyLocation = useCallback(async () => {
    try {
      const { status: existing } = await Location.getForegroundPermissionsAsync();
      if (existing !== "granted") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Location needed",
            "Allow location to see yourself on the Social Map and discover nearby coin drops.",
            [
              { text: "Not now", style: "cancel" },
              { text: "Open Settings", onPress: () => void Linking.openSettings() },
            ],
          );
          return;
        }
      }
      setLocationGranted(true);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coord: [number, number] = [loc.coords.longitude, loc.coords.latitude];
      setUserCoord(coord);
      cameraRef.current?.setCamera({
        centerCoordinate: coord,
        zoomLevel: 15,
        animationDuration: 800,
      });
    } catch {
      Alert.alert("Location", "Could not read your position. Try again outdoors.");
    }
  }, []);

  const footerBottom = Math.max(bottomInset, 12) + 108;

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={VOLT_DOODLE_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: mapCenter,
            zoomLevel: 15,
          }}
          followUserLocation={locationGranted}
          followUserMode={UserTrackingMode.Follow}
          followZoomLevel={15}
          followPitch={0}
        />
        {locationGranted ? (
          <LocationPuck
            puckBearingEnabled
            puckBearing="heading"
            pulsing={{ isEnabled: true, color: C.mint, radius: 42 }}
          />
        ) : null}
        {coinCoords.map((c) => (
          <MarkerView
            key={c.id}
            coordinate={c.coordinate}
            allowOverlap
            allowOverlapWithPuck
          >
            <Animated.View style={[styles.coinMarker, bounceStyle]}>
              <MaterialIcons name="paid" size={20} color={C.black} />
            </Animated.View>
          </MarkerView>
        ))}
      </MapView>

      <View style={[styles.header, { paddingTop: topInset }]} pointerEvents="box-none">
        {headerLeft}
        <View style={styles.headerRight}>
          <Pressable style={styles.iconBtn} onPress={onPressLeaderboard}>
            <MaterialIcons name="emoji-events" size={22} color={C.black} />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => void handleMyLocation()}>
            <MaterialIcons name="my-location" size={22} color={C.hotPink} />
          </Pressable>
        </View>
      </View>

      <View style={styles.socialCenter} pointerEvents="box-none">
        <View style={styles.speech}>
          <Text style={styles.speechText}>{speechText}</Text>
          <View style={styles.speechTriangle} />
        </View>
        <View style={styles.avatar}>
          <Image source={avatarUrl} style={styles.avatarImg} contentFit="cover" />
        </View>
      </View>

      <View style={[styles.footerSlot, { bottom: footerBottom }]} pointerEvents="box-none">
        {footerCard}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFEAF2",
  },
  map: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    zIndex: 10,
  },
  headerRight: {
    gap: 8,
  },
  iconBtn: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    padding: 10,
    borderRadius: 20,
    ...SH4,
  },
  socialCenter: {
    position: "absolute",
    top: "40%",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 6,
  },
  speech: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
    ...SH4,
  },
  speechText: {
    fontSize: 11,
    fontWeight: "900",
    fontStyle: "italic",
    textTransform: "uppercase",
    color: C.black,
  },
  speechTriangle: {
    position: "absolute",
    bottom: -9,
    left: "50%",
    marginLeft: -8,
    width: 16,
    height: 16,
    backgroundColor: C.white,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderColor: C.black,
    transform: [{ rotate: "45deg" }],
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.hotPink,
    borderWidth: 4,
    borderColor: C.black,
    overflow: "hidden",
    shadowColor: C.black,
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 6,
  },
  avatarImg: {
    width: "100%",
    height: "100%",
  },
  coinMarker: {
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
  footerSlot: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 10,
  },
});
