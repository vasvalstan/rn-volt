package expo.modules.poselandmarkerframeprocessor

import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseLandmarkerFrameProcessorModule : Module() {
  init {
    FrameProcessorPluginRegistry.addFrameProcessorPlugin("detectPoseLandmarks") { proxy, options ->
      PoseLandmarksFrameProcessorPlugin(proxy, options)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PoseLandmarkerFrameProcessor")
  }
}
