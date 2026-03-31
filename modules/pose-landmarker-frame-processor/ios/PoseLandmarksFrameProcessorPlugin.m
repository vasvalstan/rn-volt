#import <VisionCamera/Frame.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/VisionCameraProxyHolder.h>
@import MediaPipeTasksVision;

@interface PoseLandmarksFrameProcessorPlugin : FrameProcessorPlugin
@property(nonatomic, strong, nullable) MPPPoseLandmarker *poseLandmarker;
@property(nonatomic, assign) NSInteger lastTimestampMs;
@end

@implementation PoseLandmarksFrameProcessorPlugin

- (instancetype _Nonnull)initWithProxy:(VisionCameraProxyHolder * _Nonnull)proxy
                           withOptions:(NSDictionary * _Nullable)options {
  self = [super initWithProxy:proxy withOptions:options];
  if (!self) {
    return nil;
  }

  NSString *modelPath = options[@"modelPath"];
  if (modelPath == nil || modelPath.length == 0) {
    modelPath = [[NSBundle mainBundle] pathForResource:@"pose_landmarker_full" ofType:@"task"];
  }
  if (modelPath == nil || modelPath.length == 0) {
    modelPath = [[NSBundle bundleForClass:self.class] pathForResource:@"pose_landmarker_full" ofType:@"task"];
  }

  if (modelPath == nil || modelPath.length == 0) {
    NSLog(@"[PoseLandmarkerFrameProcessor] Missing pose_landmarker_full.task model file in app bundle.");
    return self;
  }

  NSNumber *rawNumPoses = options[@"numPoses"];
  NSNumber *rawMinPoseDetectionConfidence = options[@"minPoseDetectionConfidence"];
  NSNumber *rawMinPosePresenceConfidence = options[@"minPosePresenceConfidence"];
  NSNumber *rawMinTrackingConfidence = options[@"minTrackingConfidence"];

  MPPPoseLandmarkerOptions *landmarkerOptions = [[MPPPoseLandmarkerOptions alloc] init];
  landmarkerOptions.baseOptions.modelAssetPath = modelPath;
  landmarkerOptions.runningMode = MPPRunningModeVideo;
  landmarkerOptions.numPoses = rawNumPoses != nil ? rawNumPoses.integerValue : 1;
  landmarkerOptions.minPoseDetectionConfidence =
      rawMinPoseDetectionConfidence != nil ? rawMinPoseDetectionConfidence.floatValue : 0.5f;
  landmarkerOptions.minPosePresenceConfidence =
      rawMinPosePresenceConfidence != nil ? rawMinPosePresenceConfidence.floatValue : 0.5f;
  landmarkerOptions.minTrackingConfidence =
      rawMinTrackingConfidence != nil ? rawMinTrackingConfidence.floatValue : 0.5f;
  landmarkerOptions.shouldOutputSegmentationMasks = NO;

  NSError *setupError = nil;
  self.poseLandmarker = [[MPPPoseLandmarker alloc] initWithOptions:landmarkerOptions error:&setupError];
  if (setupError != nil) {
    NSLog(@"[PoseLandmarkerFrameProcessor] Failed to initialize landmarker: %@", setupError);
  }

  self.lastTimestampMs = 0;
  return self;
}

- (NSDictionary *)emptyResultForFrame:(Frame *)frame {
  return @{
    @"landmarks" : @[],
    @"frameWidth" : @((CGFloat)frame.width),
    @"frameHeight" : @((CGFloat)frame.height),
    @"isMirrored" : @(frame.isMirrored),
    @"orientation" : @(frame.orientation),
  };
}

- (id _Nullable)callback:(Frame * _Nonnull)frame
           withArguments:(NSDictionary * _Nullable)arguments {
  if (self.poseLandmarker == nil) {
    return [self emptyResultForFrame:frame];
  }

  // Pass UIImageOrientationUp so MediaPipe processes the raw buffer without rotation.
  // Landmarks will be in the raw pixel buffer coordinate space.
  // JS handles the full transform to match the preview.
  NSError *imageError = nil;
  MPPImage *image =
      [[MPPImage alloc] initWithSampleBuffer:frame.buffer orientation:UIImageOrientationUp error:&imageError];
  if (image == nil || imageError != nil) {
    if (imageError != nil) {
      NSLog(@"[PoseLandmarkerFrameProcessor] Failed to build MPImage: %@", imageError);
    }
    return [self emptyResultForFrame:frame];
  }

  NSInteger timestampMs = (NSInteger)llround(frame.timestamp);
  if (timestampMs <= self.lastTimestampMs) {
    timestampMs = self.lastTimestampMs + 1;
  }
  self.lastTimestampMs = timestampMs;

  NSError *detectError = nil;
  MPPPoseLandmarkerResult *result = [self.poseLandmarker detectVideoFrame:image
                                                  timestampInMilliseconds:timestampMs
                                                                    error:&detectError];
  if (result == nil || detectError != nil) {
    if (detectError != nil) {
      NSLog(@"[PoseLandmarkerFrameProcessor] Pose detection failed: %@", detectError);
    }
    return [self emptyResultForFrame:frame];
  }

  NSMutableArray<NSArray<NSDictionary *> *> *poses = [NSMutableArray arrayWithCapacity:result.landmarks.count];
  for (NSArray<MPPNormalizedLandmark *> *pose in result.landmarks) {
    NSMutableArray<NSDictionary *> *serializedPose = [NSMutableArray arrayWithCapacity:pose.count];
    NSInteger keypoint = 0;
    for (MPPNormalizedLandmark *landmark in pose) {
      [serializedPose addObject:@{
        @"keypoint" : @(keypoint),
        @"x" : @(landmark.x),
        @"y" : @(landmark.y),
        @"z" : @(landmark.z),
        @"visibility" : landmark.visibility != nil ? landmark.visibility : @(0.0),
        @"presence" : landmark.presence != nil ? landmark.presence : @(0.0),
      }];
      keypoint += 1;
    }
    [poses addObject:serializedPose];
  }

  return @{
    @"landmarks" : poses,
    @"frameWidth" : @(image.width),
    @"frameHeight" : @(image.height),
    @"isMirrored" : @(frame.isMirrored),
    @"orientation" : @(frame.orientation),
  };
}

VISION_EXPORT_FRAME_PROCESSOR(PoseLandmarksFrameProcessorPlugin, detectPoseLandmarks)

@end
