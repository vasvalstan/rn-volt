import { NativeModule, requireNativeModule } from 'expo';

import { PoseLandmarkerFrameProcessorModuleEvents } from './PoseLandmarkerFrameProcessor.types';

declare class PoseLandmarkerFrameProcessorModule extends NativeModule<PoseLandmarkerFrameProcessorModuleEvents> {
  emitEmptyPose(): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<PoseLandmarkerFrameProcessorModule>('PoseLandmarkerFrameProcessor');
