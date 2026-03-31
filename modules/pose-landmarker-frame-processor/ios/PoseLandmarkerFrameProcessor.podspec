Pod::Spec.new do |s|
  s.name           = 'PoseLandmarkerFrameProcessor'
  s.version        = '1.0.0'
  s.summary        = 'VisionCamera frame processor for pose landmarks'
  s.description    = 'Local Expo module that hosts a VisionCamera frame processor for MediaPipe pose landmarks.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'VisionCamera'
  s.dependency 'MediaPipeTasksVision'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES',
    'OTHER_LDFLAGS' => '-framework MediaPipeTasksCommon -framework MediaPipeTasksVision',
    'FRAMEWORK_SEARCH_PATHS' => [
      '"${PODS_XCFRAMEWORKS_BUILD_DIR}/MediaPipeTasksVision"',
      '"${PODS_XCFRAMEWORKS_BUILD_DIR}/MediaPipeTasksCommon"',
    ].join(' '),
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.resources = ["Resources/*.task"]
end
