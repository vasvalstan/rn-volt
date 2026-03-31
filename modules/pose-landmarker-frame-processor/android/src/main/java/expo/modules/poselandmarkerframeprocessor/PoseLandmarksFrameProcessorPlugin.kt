package expo.modules.poselandmarkerframeprocessor

import androidx.annotation.NonNull
import androidx.annotation.Nullable
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy

class PoseLandmarksFrameProcessorPlugin(
  proxy: VisionCameraProxy?,
  options: Map<String?, Any?>?,
) : FrameProcessorPlugin() {
  @Nullable
  override fun callback(
    @NonNull frame: Frame,
    @Nullable arguments: Map<String, Any>?,
  ): Any? {
    // TODO: Replace this placeholder with MediaPipe Pose Landmarker inference.
    return mapOf(
      "landmarks" to emptyList<List<Map<String, Double>>>(),
      "frameWidth" to frame.width,
      "frameHeight" to frame.height,
    )
  }
}
