import type { StyleProp, ViewStyle } from 'react-native';

export type PoseLandmark = {
  keypoint: number;
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
};

export type PoseLandmarkerFrameProcessorModuleEvents = {
  onPoseDetected: (params: PoseDetectionResult) => void;
};

export type PoseDetectionResult = {
  landmarks: PoseLandmark[][];
  frameWidth: number;
  frameHeight: number;
  isMirrored?: boolean;
  orientation?: number;
};

export type OnLoadEventPayload = {
  url: string;
};

export type PoseLandmarkerFrameProcessorViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: OnLoadEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};
