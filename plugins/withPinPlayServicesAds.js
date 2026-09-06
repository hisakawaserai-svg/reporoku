const { withProjectBuildGradle } = require("expo/config-plugins");

const ADS = "25.0.0";
const FORCE_BLOCK = `    configurations.configureEach {
      resolutionStrategy {
        force "com.google.android.gms:play-services-ads:${ADS}"
      }
    }
`;

/**
 * play-services-ads 25.3+ は Kotlin 2.3 metadata で Expo 57 (Kotlin 2.1) と合わない。
 * react-native-google-mobile-ads 16.3 が使う 25.0.0 に固定する。
 */
function withPinPlayServicesAds(config) {
  return withProjectBuildGradle(config, (mod) => {
    let src = mod.modResults.contents;
    if (src.includes(`play-services-ads:${ADS}`)) {
      return mod;
    }
    src = src.replace(/allprojects \{\n  repositories \{/, `allprojects {\n${FORCE_BLOCK}  repositories {`);
    mod.modResults.contents = src;
    return mod;
  });
}

module.exports = withPinPlayServicesAds;
