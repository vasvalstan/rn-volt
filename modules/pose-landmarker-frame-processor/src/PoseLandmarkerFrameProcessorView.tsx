import { requireNativeView } from 'expo';
import * as React from 'react';

import { PoseLandmarkerFrameProcessorViewProps } from './PoseLandmarkerFrameProcessor.types';

const NativeView: React.ComponentType<PoseLandmarkerFrameProcessorViewProps> =
  requireNativeView('PoseLandmarkerFrameProcessor');

export default function PoseLandmarkerFrameProcessorView(props: PoseLandmarkerFrameProcessorViewProps) {
  return <NativeView {...props} />;
}
