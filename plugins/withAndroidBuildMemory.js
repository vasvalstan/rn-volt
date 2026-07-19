const { withGradleProperties } = require("expo/config-plugins");

const GRADLE_JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8";

module.exports = function withAndroidBuildMemory(config) {
  return withGradleProperties(config, (gradleConfig) => {
    const property = gradleConfig.modResults.find(
      (item) => item.type === "property" && item.key === "org.gradle.jvmargs",
    );

    if (property?.type === "property") {
      property.value = GRADLE_JVM_ARGS;
    } else {
      gradleConfig.modResults.push({
        type: "property",
        key: "org.gradle.jvmargs",
        value: GRADLE_JVM_ARGS,
      });
    }

    return gradleConfig;
  });
};
