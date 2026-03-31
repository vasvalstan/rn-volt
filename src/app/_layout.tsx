import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { convex, secureStorage } from "../lib/convex";
import { configureRevenueCat } from "../lib/revenuecat";

export default function RootLayout() {
  useEffect(() => {
    configureRevenueCat();
  }, []);

  return (
    <ConvexAuthProvider client={convex} storage={secureStorage}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
      </GestureHandlerRootView>
    </ConvexAuthProvider>
  );
}
