# Pose Integration Next Steps

This app now uses the recommended architecture:

- VisionCamera for front-camera live stream
- Local Expo module for native frame processing
- Rep-counter state machine in TypeScript

## Current status

- Camera-verified activities (`pushups`, `squats`) open a dedicated session screen.
- iOS frame processor now runs MediaPipe Pose Landmarker using `MediaPipeTasksVision`.
- The iOS model (`pose_landmarker_full.task`) is bundled via the local pod resources.
- Android frame processor is still a scaffold and returns placeholder landmarks.
- Rep counting logic is implemented in `src/lib/pose/repCounter.ts`.

## Remaining native work

1. Integrate MediaPipe Pose Landmarker in Android frame processor callback.
2. Tune thresholds in `repCounter.ts` with real camera recordings.
3. Add anti-cheat checks:
   - minimum visibility confidence
   - minimum rep duration
   - body-in-frame gating

## Runtime requirement

VisionCamera is not supported in Expo Go. Use a development build:

- `npx expo run:ios`
- `npx expo run:android`

or EAS development builds.
