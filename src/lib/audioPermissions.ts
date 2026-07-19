import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";

export async function ensureRecordingPermissionAsync(): Promise<void> {
  const currentPermission = await getRecordingPermissionsAsync();
  if (currentPermission.granted) return;

  if (currentPermission.canAskAgain === false) {
    throw new Error("Microphone permission is blocked. Enable it in Settings to record voice.");
  }

  const requestedPermission = await requestRecordingPermissionsAsync();
  if (!requestedPermission.granted) {
    throw new Error("Microphone permission is needed to record voice.");
  }
}
