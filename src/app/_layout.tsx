import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import DevErrorBoundary from "../components/DevErrorBoundary";
import {
  convex,
  convexConfigurationError,
  secureStorage,
} from "../lib/convex";
import { configureRevenueCat } from "../lib/revenuecat";

export default function RootLayout() {
  useEffect(() => {
    configureRevenueCat();
  }, []);

  if (!convex) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.configurationError}>
          <Text style={styles.configurationErrorTitle}>
            App configuration unavailable
          </Text>
          <Text style={styles.configurationErrorBody}>
            This build cannot connect to the Volt service. Please install an
            updated build.
          </Text>
          {__DEV__ ? (
            <Text style={styles.configurationErrorDetail}>
              {convexConfigurationError}
            </Text>
          ) : null}
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <DevErrorBoundary>
      <ConvexAuthProvider client={convex} storage={secureStorage}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false }} />
        </GestureHandlerRootView>
      </ConvexAuthProvider>
    </DevErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F8F8F4",
  },
  configurationError: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  configurationErrorTitle: {
    color: "#161616",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center",
  },
  configurationErrorBody: {
    color: "#555555",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  configurationErrorDetail: {
    color: "#8A3654",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 18,
    textAlign: "center",
  },
});
