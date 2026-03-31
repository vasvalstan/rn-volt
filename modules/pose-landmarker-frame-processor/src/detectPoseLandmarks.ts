import type { Frame } from 'react-native-vision-camera';
import { VisionCameraProxy } from 'react-native-vision-camera';

import type { PoseDetectionResult } from './PoseLandmarkerFrameProcessor.types';

const posePlugin = VisionCameraProxy.initFrameProcessorPlugin('detectPoseLandmarks', {
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

export function detectPoseLandmarks(frame: Frame): PoseDetectionResult | null {
  'worklet';
  if (posePlugin == null) return null;
  return posePlugin.call(frame) as unknown as PoseDetectionResult;
}
