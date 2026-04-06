const { withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

/**
 * Expo config plugin that enables iCloud Document Storage for backup.
 *
 * Adds iCloud container entitlements and Info.plist keys required for
 * iCloud Documents access via react-native-cloud-storage.
 */

const ICLOUD_CONTAINER = "iCloud.com.veloq.app";

function withICloudEntitlements(config) {
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.icloud-container-identifiers"] = [
      ICLOUD_CONTAINER,
    ];
    mod.modResults["com.apple.developer.ubiquity-container-identifiers"] = [
      ICLOUD_CONTAINER,
    ];
    mod.modResults["com.apple.developer.icloud-services"] = [
      "CloudDocuments",
    ];
    return mod;
  });
}

function withICloudInfoPlist(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSUbiquitousContainers = {
      [ICLOUD_CONTAINER]: {
        NSUbiquitousContainerIsDocumentScopePublic: true,
        NSUbiquitousContainerSupportedFolderLevels: "Any",
        NSUbiquitousContainerName: "Veloq",
      },
    };
    return mod;
  });
}

module.exports = function withICloud(config) {
  config = withICloudEntitlements(config);
  config = withICloudInfoPlist(config);
  return config;
};
