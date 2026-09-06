const { withAppBuildGradle } = require("expo/config-plugins");

const LOAD_PROPS = `def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new InputStreamReader(new FileInputStream(keystorePropertiesFile), "UTF-8"))
}

`;

const RELEASE_SIGNING = `        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
            }
        }
`;

/** Release AAB を upload keystore で署名する。keystore.properties は git に入れない。 */
function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let src = mod.modResults.contents;
    if (!src.includes("keystorePropertiesFile")) {
      src = src.replace(/\nandroid \{/, `\n${LOAD_PROPS}android {`);
    }
    if (!src.includes("storeFile file(keystoreProperties['storeFile'])")) {
      src = src.replace(
        /signingConfigs \{\n        debug \{/,
        `signingConfigs {\n${RELEASE_SIGNING}        debug {`
      );
    }
    src = src.replace(
      /signingConfig keystorePropertiesFile\.exists\(\) \? signingConfigs\.release : signingConfigs\.debug\n/,
      `signingConfig signingConfigs.release
            if (!keystorePropertiesFile.exists()) {
                throw new GradleException("android/keystore.properties がありません。Release を debug 署名しないようビルドを止めます。")
            }
`
    );
    src = src.replace(
      /release \{\n            \/\/ Caution![\s\S]*?signingConfig signingConfigs\.debug\n/,
      `release {\n            signingConfig signingConfigs.release
            if (!keystorePropertiesFile.exists()) {
                throw new GradleException("android/keystore.properties がありません。Release を debug 署名しないようビルドを止めます。")
            }
`
    );
    mod.modResults.contents = src;
    return mod;
  });
}

module.exports = withAndroidReleaseSigning;
