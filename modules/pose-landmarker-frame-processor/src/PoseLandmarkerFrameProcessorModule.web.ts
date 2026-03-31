import { registerWebModule, NativeModule } from 'expo';

import { PoseDetectionResult } from './PoseLandmarkerFrameProcessor.types';

type PoseLandmarkerFrameProcessorModuleEvents = {
  onPoseDetected: (params: PoseDetectionResult) => void;
};

class PoseLandmarkerFrameProcessorModule extends NativeModule<PoseLandmarkerFrameProcessorModuleEvents> {
  async emitEmptyPose(): Promise<void> {
    this.emit('onPoseDetected', {
      landmarks: [],
      frameWidth: 0,
      frameHeight: 0,
    });
  }
}

export default registerWebModule(
  PoseLandmarkerFrameProcessorModule,
  'PoseLandmarkerFrameProcessor'
);
