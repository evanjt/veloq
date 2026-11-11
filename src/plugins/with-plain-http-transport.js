const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin that lets a release build carry plain http to a WebDAV
 * server the athlete hosts, wherever it is.
 *
 * The app's address check (`webdavUrlProblem`) accepts http to any host and
 * the form warns about it, so each platform's transport has to carry http to
 * any host, or the form saves an address every backup then fails against. The
 * app's own services stay on https.
 *
 * Android blocks cleartext from API 28 unless the manifest allows it, so the
 * base config permits cleartext and the app's own services are pinned back to
 * https.
 *
 * iOS App Transport Security allows arbitrary loads, and the same services get
 * an exception domain that keeps insecure http off.
 */

const NETWORK_SECURITY_CONFIG = 'veloq_network_security_config';

/** The app's own services, which never take plain http whatever the athlete allows. */
const HTTPS_ONLY_DOMAINS = ['intervals.icu', 'veloq.fit'];

const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq network security config: plain http everywhere but the app's own services -->
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
  <domain-config cleartextTrafficPermitted="false">
${HTTPS_ONLY_DOMAINS.map((domain) => `    <domain includeSubdomains="true">${domain}</domain>`).join('\n')}
  </domain-config>
</network-security-config>
`;

/** Point the application at the network security config. */
function configureManifest(mainApplication) {
  mainApplication.$['android:networkSecurityConfig'] = `@xml/${NETWORK_SECURITY_CONFIG}`;
}

/** Write the network security config into an `res/xml` directory, creating it if needed. */
function writeNetworkSecurityConfig(resDir) {
  fs.mkdirSync(resDir, { recursive: true });
  fs.writeFileSync(path.join(resDir, `${NETWORK_SECURITY_CONFIG}.xml`), NETWORK_SECURITY_XML);
}

/**
 * Allow plain http in an ATS dictionary, with the app's own services kept on
 * https and every other setting kept.
 */
function withPlainHttpAllowed(ats = {}) {
  const exceptions = { ...(ats.NSExceptionDomains ?? {}) };
  for (const domain of HTTPS_ONLY_DOMAINS) {
    exceptions[domain] = {
      ...(exceptions[domain] ?? {}),
      NSIncludesSubdomains: true,
      NSExceptionAllowsInsecureHTTPLoads: false,
    };
  }
  return {
    ...ats,
    NSAllowsArbitraryLoads: true,
    NSExceptionDomains: exceptions,
  };
}

function withPlainHttpTransport(config) {
  config = withAndroidManifest(config, async (mod) => {
    writeNetworkSecurityConfig(
      path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
    );
    configureManifest(AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults));
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSAppTransportSecurity = withPlainHttpAllowed(
      mod.modResults.NSAppTransportSecurity
    );
    return mod;
  });

  return config;
}

module.exports = withPlainHttpTransport;
module.exports.NETWORK_SECURITY_XML = NETWORK_SECURITY_XML;
module.exports.configureManifest = configureManifest;
module.exports.writeNetworkSecurityConfig = writeNetworkSecurityConfig;
module.exports.withPlainHttpAllowed = withPlainHttpAllowed;
