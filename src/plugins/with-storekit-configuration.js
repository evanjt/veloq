const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Gives the generated iOS project the StoreKit configuration the simulator
 * serves in-app purchases from. The tracked copy is
 * `config/StoreKitConfiguration.storekit`; generation copies it into the app
 * directory and points the scheme's launch action at it, so a Debug run on the
 * simulator offers the configured products with no sandbox account.
 *
 * Only the Dev identity carries it: `app.config.js` adds this plugin when
 * APP_VARIANT is not production. An archive ignores a launch action either way.
 */

const SOURCE = path.join("config", "StoreKitConfiguration.storekit");
const FILE = "StoreKitConfiguration.storekit";

/** The scheme with a StoreKit reference inside its launch action, added once. */
function addStoreKitReference(scheme, identifier) {
  if (scheme.includes("<StoreKitConfigurationFileReference")) return scheme;
  const close = scheme.indexOf("</LaunchAction>");
  if (close === -1 || !scheme.includes("<LaunchAction")) {
    throw new Error("with-storekit-configuration: the scheme has no LaunchAction to reference the StoreKit configuration from");
  }
  const reference =
    `   <StoreKitConfigurationFileReference\n` +
    `         identifier = "${identifier}">\n` +
    `      </StoreKitConfigurationFileReference>\n   `;
  return scheme.slice(0, close) + reference + scheme.slice(close);
}

function withStoreKitConfiguration(config) {
  return withDangerousMod(config, [
    "ios",
    async (mod) => {
      const { projectRoot, platformProjectRoot, projectName } = mod.modRequest;
      fs.copyFileSync(
        path.join(projectRoot, SOURCE),
        path.join(platformProjectRoot, projectName, FILE)
      );

      const schemePath = path.join(
        platformProjectRoot,
        `${projectName}.xcodeproj`,
        "xcshareddata",
        "xcschemes",
        `${projectName}.xcscheme`
      );
      if (!fs.existsSync(schemePath)) {
        throw new Error(`with-storekit-configuration: ${schemePath} does not exist`);
      }
      const scheme = fs.readFileSync(schemePath, "utf8");
      const patched = addStoreKitReference(scheme, `../${projectName}/${FILE}`);
      if (patched !== scheme) fs.writeFileSync(schemePath, patched);
      return mod;
    },
  ]);
}

module.exports = withStoreKitConfiguration;
module.exports.addStoreKitReference = addStoreKitReference;
