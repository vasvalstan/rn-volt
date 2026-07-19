const { withPodfile } = require("expo/config-plugins");

const START_MARKER = "# @generated begin volt-mediapipe-linking";
const END_MARKER = "# @generated end volt-mediapipe-linking";
const LEGACY_MARKER = "# MediaPipe Tasks pods ship xcframeworks only;";

const POST_INSTALL_BLOCK = [
  "",
  `    ${START_MARKER}`,
  "    # MediaPipe Tasks pods are xcframeworks, but CocoaPods can emit invalid -l flags.",
  "    %w[debug release].each do |configuration|",
  "      xcconfig_path = File.join(",
  "        installer.sandbox.root,",
  "        'Target Support Files',",
  "        'Pods-test',",
  '        "Pods-test.#{configuration}.xcconfig"',
  "      )",
  "      next unless File.exist?(xcconfig_path)",
  "",
  "      contents = File.read(xcconfig_path)",
  '      contents.gsub!(/-l"MediaPipeTasksCommon"\\s+/, \'\')',
  '      contents.gsub!(/-l"MediaPipeTasksVision"\\s+/, \'\')',
  "",
  "      contents.sub!(/^(FRAMEWORK_SEARCH_PATHS = .+)$/) do |fsp|",
  "        fsp.include?('PODS_XCFRAMEWORKS_BUILD_DIR}/MediaPipeTasksCommon\"') ? fsp : \"#{fsp} \\\"${PODS_XCFRAMEWORKS_BUILD_DIR}/MediaPipeTasksCommon\\\" \\\"${PODS_XCFRAMEWORKS_BUILD_DIR}/MediaPipeTasksVision\\\"\"",
  "      end",
  "",
  "      contents.sub!(/^(OTHER_LDFLAGS = .+)$/) do |ldflags|",
  "        ldflags.include?('-framework \"MediaPipeTasksCommon\"') ? ldflags : \"#{ldflags} -framework \\\"MediaPipeTasksCommon\\\" -framework \\\"MediaPipeTasksVision\\\"\"",
  "      end",
  "",
  "      File.write(xcconfig_path, contents)",
  "    end",
  `    ${END_MARKER}`,
  "",
].join("\n");

function removeExistingBlock(contents) {
  const start = contents.indexOf(START_MARKER);
  if (start < 0) return contents;

  const end = contents.indexOf(END_MARKER, start);
  if (end < 0) {
    throw new Error(`Found ${START_MARKER} without ${END_MARKER}`);
  }

  const lineStart = contents.lastIndexOf("\n", start);
  const lineEnd = contents.indexOf("\n", end + END_MARKER.length);
  return contents.slice(0, Math.max(0, lineStart)) + contents.slice(lineEnd + 1);
}

function findReactNativePostInstallEnd(contents) {
  const callStart = contents.indexOf("react_native_post_install(");
  if (callStart < 0) {
    throw new Error("Could not find react_native_post_install in the generated Podfile");
  }

  const openParen = contents.indexOf("(", callStart);
  let depth = 0;
  for (let index = openParen; index < contents.length; index += 1) {
    if (contents[index] === "(") depth += 1;
    if (contents[index] === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  throw new Error("Could not find the end of react_native_post_install in the generated Podfile");
}

module.exports = function withMediaPipeIosLinking(config) {
  return withPodfile(config, (podfileConfig) => {
    if (
      podfileConfig.modResults.contents.includes(LEGACY_MARKER) &&
      !podfileConfig.modResults.contents.includes(START_MARKER)
    ) {
      return podfileConfig;
    }

    const contents = removeExistingBlock(podfileConfig.modResults.contents);
    const insertionPoint = findReactNativePostInstallEnd(contents);

    podfileConfig.modResults.contents =
      contents.slice(0, insertionPoint) +
      POST_INSTALL_BLOCK +
      contents.slice(insertionPoint);

    return podfileConfig;
  });
};
