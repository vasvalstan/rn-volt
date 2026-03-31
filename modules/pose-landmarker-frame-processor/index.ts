// Reexport the native module. On web, it will be resolved to PoseLandmarkerFrameProcessorModule.web.ts
// and on native platforms to PoseLandmarkerFrameProcessorModule.ts
export { default } from './src/PoseLandmarkerFrameProcessorModule';
export { default as PoseLandmarkerFrameProcessorView } from './src/PoseLandmarkerFrameProcessorView';
export * from './src/PoseLandmarkerFrameProcessor.types';
export * from './src/detectPoseLandmarks';
