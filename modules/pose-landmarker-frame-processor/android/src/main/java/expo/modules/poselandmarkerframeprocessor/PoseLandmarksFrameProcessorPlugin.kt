package expo.modules.poselandmarkerframeprocessor

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.util.Log
import androidx.annotation.NonNull
import androidx.annotation.Nullable
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import java.nio.ByteBuffer
import kotlin.math.max

class PoseLandmarksFrameProcessorPlugin(
  proxy: VisionCameraProxy?,
  options: Map<String?, Any?>?,
) : FrameProcessorPlugin() {
  private var poseLandmarker: PoseLandmarker? = null
  private var lastTimestampMs: Long = 0
  private var nv21Bytes = ByteArray(0)
  private var nv21ByteBuffer = ByteBuffer.wrap(nv21Bytes)

  init {
    try {
      val minPoseDetectionConfidence =
        (options?.get("minPoseDetectionConfidence") as? Number)?.toFloat() ?: 0.5f
      val minPosePresenceConfidence =
        (options?.get("minPosePresenceConfidence") as? Number)?.toFloat() ?: 0.5f
      val minTrackingConfidence =
        (options?.get("minTrackingConfidence") as? Number)?.toFloat() ?: 0.5f
      val numPoses = (options?.get("numPoses") as? Number)?.toInt() ?: 1

      val baseOptions = BaseOptions.builder()
        .setModelAssetPath("pose_landmarker_full.task")
        .build()

      val landmarkerOptions = PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(baseOptions)
        .setRunningMode(RunningMode.VIDEO)
        .setNumPoses(numPoses)
        .setMinPoseDetectionConfidence(minPoseDetectionConfidence)
        .setMinPosePresenceConfidence(minPosePresenceConfidence)
        .setMinTrackingConfidence(minTrackingConfidence)
        .setOutputSegmentationMasks(false)
        .build()

      val context = proxy?.context
      if (context != null) {
        poseLandmarker = PoseLandmarker.createFromOptions(context, landmarkerOptions)
      } else {
        Log.w("PoseLandmarkerFrameProcessor", "VisionCamera proxy context unavailable.")
      }
    } catch (error: Throwable) {
      Log.e("PoseLandmarkerFrameProcessor", "Failed to initialize MediaPipe Pose Landmarker.", error)
      poseLandmarker = null
    }
  }

  private fun emptyResult(frame: Frame): Map<String, Any?> {
    return mapOf(
      "landmarks" to emptyList<List<Map<String, Double>>>(),
      "frameWidth" to frame.width,
      "frameHeight" to frame.height,
      "isMirrored" to frame.isMirrored,
      "orientation" to frame.orientation.unionValue,
    )
  }

  private fun imageProxyToMpImage(imageProxy: ImageProxy): MPImage {
    if (imageProxy.format == ImageFormat.YUV_420_888) {
      val requiredSize = imageProxy.width * imageProxy.height * 3 / 2
      if (nv21Bytes.size != requiredSize) {
        nv21Bytes = ByteArray(requiredSize)
        nv21ByteBuffer = ByteBuffer.wrap(nv21Bytes)
      }
      yuv420ToNv21(imageProxy, nv21Bytes)
      nv21ByteBuffer.clear()
      return ByteBufferImageBuilder(
        nv21ByteBuffer,
        imageProxy.width,
        imageProxy.height,
        MPImage.IMAGE_FORMAT_NV21,
      ).build()
    }

    val plane = imageProxy.planes.firstOrNull()
      ?: throw IllegalArgumentException("Frame has no image planes.")
    val buffer = plane.buffer
    val bitmap = Bitmap.createBitmap(imageProxy.width, imageProxy.height, Bitmap.Config.ARGB_8888)
    bitmap.copyPixelsFromBuffer(buffer.rewindForRead())
    return BitmapImageBuilder(bitmap).build()
  }

  private fun ByteBuffer.rewindForRead(): ByteBuffer {
    rewind()
    return this
  }

  private fun yuv420ToNv21(imageProxy: ImageProxy, nv21: ByteArray) {
    val yPlane = imageProxy.planes[0]
    val uPlane = imageProxy.planes[1]
    val vPlane = imageProxy.planes[2]
    val width = imageProxy.width
    val height = imageProxy.height

    var outputOffset = 0
    val yBuffer = yPlane.buffer.rewindForRead()
    for (row in 0 until height) {
      val rowStart = row * yPlane.rowStride
      yBuffer.position(rowStart)
      yBuffer.get(nv21, outputOffset, width)
      outputOffset += width
    }

    val uBuffer = uPlane.buffer.rewindForRead()
    val vBuffer = vPlane.buffer.rewindForRead()
    val chromaHeight = height / 2
    val chromaWidth = width / 2
    for (row in 0 until chromaHeight) {
      for (col in 0 until chromaWidth) {
        val vuIndex = row * vPlane.rowStride + col * vPlane.pixelStride
        val uuIndex = row * uPlane.rowStride + col * uPlane.pixelStride
        nv21[outputOffset++] = vBuffer.get(vuIndex)
        nv21[outputOffset++] = uBuffer.get(uuIndex)
      }
    }
  }

  @Nullable
  override fun callback(
    @NonNull frame: Frame,
    @Nullable arguments: Map<String, Any>?,
  ): Any? {
    val landmarker = poseLandmarker ?: return emptyResult(frame)
    return try {
      val imageProxy = frame.imageProxy
      val mpImage = imageProxyToMpImage(imageProxy)
      try {
        val frameTimestampMs = max(1L, frame.timestamp / 1_000_000L)
        val timestampMs =
          if (frameTimestampMs <= lastTimestampMs) lastTimestampMs + 1 else frameTimestampMs
        lastTimestampMs = timestampMs

        val result = landmarker.detectForVideo(mpImage, timestampMs)
        val poses = result.landmarks().map { pose ->
          pose.mapIndexed { index, landmark ->
            mapOf(
              "keypoint" to index,
              "x" to landmark.x().toDouble(),
              "y" to landmark.y().toDouble(),
              "z" to landmark.z().toDouble(),
              "visibility" to landmark.visibility().orElse(0f).toDouble(),
              "presence" to landmark.presence().orElse(0f).toDouble(),
            )
          }
        }

        mapOf(
          "landmarks" to poses,
          "frameWidth" to mpImage.width,
          "frameHeight" to mpImage.height,
          "isMirrored" to frame.isMirrored,
          "orientation" to frame.orientation.unionValue,
        )
      } finally {
        mpImage.close()
      }
    } catch (error: Throwable) {
      Log.e("PoseLandmarkerFrameProcessor", "Pose detection failed.", error)
      emptyResult(frame)
    }
  }
}
