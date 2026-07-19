import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { Camera, LocationPuck, MapView, MarkerView, UserTrackingMode } from "@rnmapbox/maps";
import { MaterialIcons } from "@react-native-vector-icons/material-icons";
import { VOLT_DOODLE_STYLE_URL } from "../lib/voltMapboxDoodleStyle";

const C = {
  hotPink: "#FF2D78",
  cyan: "#00CEE5",
  peach: "#FEB584",
  electricYellow: "#EEF568",
  purple: "#8A38F5",
  amber: "#C77B00",
  black: "#1A1A1A",
  white: "#FFFFFF",
};

const SH2 = {
  shadowColor: C.black,
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 2,
} as const;

const DEFAULT_CENTER: [number, number] = [-122.4194, 37.7749];

function offsetMeters(lat: number, lng: number, distanceM: number, bearingDeg: number): [number, number] {
  const bearing = (bearingDeg * Math.PI) / 180;
  const radius = 6378137;
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lng * Math.PI) / 180;
  const angularDistance = distanceM / radius;
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
  );
  return [(nextLongitude * 180) / Math.PI, (nextLatitude * 180) / Math.PI];
}

export type SocialMapScreenProps = {
  readonly topInset: number;
  readonly bottomInset: number;
  readonly vp: number;
  readonly coins: number;
  readonly streak: number;
  readonly onPressLeaderboard: () => void;
  readonly onPressStore: () => void;
  readonly onPressFriends: () => void;
  /** Figma-style discovery/activity carousel rendered above the floating tab bar. */
  readonly footerCard: ReactNode;
};

function StatChip({
  tone,
  icon,
  label,
}: {
  readonly tone: "cyan" | "peach" | "white";
  readonly icon: "bolt" | "coin" | "streak";
  readonly label: string;
}) {
  return (
    <View
      style={[
        styles.statChip,
        tone === "cyan" ? styles.statCyan : tone === "peach" ? styles.statPeach : styles.statWhite,
      ]}
    >
      {icon === "coin" ? (
        <Text style={styles.statEmoji}>🪙</Text>
      ) : icon === "streak" ? (
        <Text style={styles.statEmoji}>🧨</Text>
      ) : (
        <MaterialIcons name="bolt" size={22} color={C.electricYellow} />
      )}
      <Text style={styles.statText}>{label}</Text>
    </View>
  );
}

function RailButton({
  icon,
  color,
  label,
  onPress,
}: {
  readonly icon: "emoji-events" | "storefront" | "people" | "my-location";
  readonly color: string;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.railButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialIcons name={icon} size={40} color={color} />
    </Pressable>
  );
}

/**
 * Social tab composition from Figma node 169:2183, backed by the app's live
 * Mapbox integration and its cartoon/doodle map style.
 */
export default function SocialMapScreen({
  topInset,
  bottomInset,
  vp,
  coins,
  streak,
  onPressLeaderboard,
  onPressStore,
  onPressFriends,
  footerCard,
}: SocialMapScreenProps) {
  const footerBottom = Math.max(bottomInset, 12) + 108;
  const [locationGranted, setLocationGranted] = useState(false);
  const [userCoordinate, setUserCoordinate] = useState<[number, number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    void (async () => {
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        const status = existing.status === "undetermined"
          ? (await Location.requestForegroundPermissionsAsync()).status
          : existing.status;
        if (cancelled || status !== "granted") return;
        setLocationGranted(true);
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setUserCoordinate([first.coords.longitude, first.coords.latitude]);
        const nextSubscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 8000 },
          (location) => {
            if (!cancelled) {
              setUserCoordinate([location.coords.longitude, location.coords.latitude]);
            }
          },
        );
        if (cancelled) {
          nextSubscription.remove();
          return;
        }
        subscription = nextSubscription;
      } catch {
        // The social map remains usable at its default center without location.
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  const handleLocationPress = useCallback(async () => {
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted" && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (permission.status !== "granted") {
        Alert.alert(
          "Location needed",
          "Enable location to center the Social map on you and place nearby coin markers correctly.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }
      setLocationGranted(true);
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setUserCoordinate([
        current.coords.longitude,
        current.coords.latitude,
      ]);
    } catch {
      Alert.alert(
        "Location unavailable",
        "Volt could not read your position. Try again with a clear view of the sky.",
      );
    }
  }, []);

  const center = userCoordinate ?? DEFAULT_CENTER;
  const [longitude, latitude] = center;
  const coinCoordinates = useMemo(
    () => [
      offsetMeters(latitude, longitude, 95, 340),
      offsetMeters(latitude, longitude, 130, 110),
      offsetMeters(latitude, longitude, 165, 205),
    ],
    [latitude, longitude],
  );

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
          defaultSettings={{ centerCoordinate: center, zoomLevel: 15 }}
          followUserLocation={Platform.OS !== "web" && locationGranted}
          followUserMode={
            Platform.OS === "web" ? undefined : UserTrackingMode.Follow
          }
          followZoomLevel={15}
          followPitch={0}
        />
        {Platform.OS !== "web" && locationGranted ? (
          <LocationPuck
            puckBearingEnabled
            puckBearing="heading"
            pulsing={{ isEnabled: true, color: C.cyan, radius: 42 }}
          />
        ) : null}
        {coinCoordinates.map((coordinate, index) => (
          <MarkerView key={`social-coin-${index}`} coordinate={coordinate} allowOverlap allowOverlapWithPuck>
            <View style={styles.coinMarker}>
              <MaterialIcons name="bolt" size={24} color={C.electricYellow} />
            </View>
          </MarkerView>
        ))}
      </MapView>

      <View style={[styles.stats, { top: topInset + 4 }]} pointerEvents="box-none">
        <View style={styles.statsLeft}>
          <StatChip tone="cyan" icon="bolt" label={`${vp} VP`} />
          <StatChip tone="peach" icon="coin" label={String(coins)} />
        </View>
        <StatChip tone="white" icon="streak" label={`DAY ${streak}`} />
      </View>

      <View style={[styles.rightRail, { top: topInset + 60 }]}>
        <RailButton icon="emoji-events" color={C.purple} label="Open leaderboard" onPress={onPressLeaderboard} />
        <RailButton icon="storefront" color={C.amber} label="Open rewards store" onPress={onPressStore} />
        <RailButton icon="people" color={C.hotPink} label="Add and view friends" onPress={onPressFriends} />
        <RailButton
          icon="my-location"
          color={locationGranted ? C.cyan : C.amber}
          label="Center map on my location"
          onPress={() => void handleLocationPress()}
        />
      </View>

      <View style={[styles.footerSlot, { bottom: footerBottom }]} pointerEvents="box-none">
        {footerCard}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFEAF2", overflow: "hidden" },
  map: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  stats: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statsLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  statChip: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 100,
    ...SH2,
  },
  statCyan: { backgroundColor: C.cyan },
  statPeach: { backgroundColor: C.peach },
  statWhite: { backgroundColor: C.white },
  statEmoji: { fontSize: 18, lineHeight: 22 },
  statText: { fontSize: 12, lineHeight: 24, fontWeight: "900", color: C.black, textTransform: "uppercase" },
  rightRail: { position: "absolute", right: 24, zIndex: 9, gap: 12 },
  railButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.black,
    ...SH2,
  },
  coinMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.cyan,
    borderWidth: 2,
    borderColor: C.black,
    alignItems: "center",
    justifyContent: "center",
    ...SH2,
  },
  footerSlot: { position: "absolute", left: 0, right: 0, zIndex: 10 },
});
