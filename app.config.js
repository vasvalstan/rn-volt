/**
 * Resolves Apple Team ID for ios.appleTeamId and react-native-device-activity.
 * Local: export APPLE_TEAM_ID=XXXXXXXXXX
 * EAS:    Project env APPLE_TEAM_ID (e.g. development environment on expo.dev)
 */
module.exports = ({ config }) => {
  const fromEnv = process.env.APPLE_TEAM_ID;
  const fromIos =
    config.ios?.appleTeamId &&
    !String(config.ios.appleTeamId).includes("REPLACE")
      ? config.ios.appleTeamId
      : null;
  const resolvedTeam = fromEnv || fromIos;

  const plugins = (config.plugins ?? []).map((entry) => {
    if (Array.isArray(entry) && entry[0] === "react-native-device-activity") {
      const opts = { ...(entry[1] ?? {}) };
      if (resolvedTeam) {
        opts.appleTeamId = resolvedTeam;
      }
      return [entry[0], opts];
    }
    return entry;
  });

  return {
    ...config,
    ios: {
      ...config.ios,
      ...(resolvedTeam ? { appleTeamId: resolvedTeam } : {}),
    },
    plugins,
  };
};
