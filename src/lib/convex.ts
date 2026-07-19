import { ConvexReactClient } from "convex/react";
import * as SecureStore from "expo-secure-store";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL?.trim() ?? "";

export let convexConfigurationError: string | null = null;

export const convex = (() => {
  if (!convexUrl) {
    convexConfigurationError =
      "This build is missing EXPO_PUBLIC_CONVEX_URL.";
    return null;
  }

  try {
    return new ConvexReactClient(convexUrl, {
      unsavedChangesWarning: false,
    });
  } catch (error) {
    convexConfigurationError =
      error instanceof Error
        ? `Invalid Convex configuration: ${error.message}`
        : "Invalid Convex configuration.";
    return null;
  }
})();

export const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};
