const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLAIN_LAN_SUFFIXES = require('../features/settings/lib/autobackup/plainLanSuffixes.json');

/**
 * Expo config plugin that lets a release build carry plain http to a WebDAV
 * server on the athlete's own network, once they have opted in.
 *
 * The address check in the app (`webdavUrlProblem`) is the gate: it accepts
 * http only behind the opt-in and only to a private address or a name under
 * one of the suffixes in `plainLanSuffixes.json`. Each platform's transport
 * has to carry everything that check accepts, or the form saves an address
 * every backup then fails against.
 *
 * Android blocks cleartext from API 28 unless the manifest allows it, and a
 * network security config cannot name an address range, so the base config
 * permits cleartext and the app's own services are pinned back to https.
 *
 * iOS local networking already covers IP literals, unqualified names and
 * `.local`. The other suffixes get an exception domain each.
 */

const NETWORK_SECURITY_CONFIG = 'veloq_network_security_config';

/** The app's own services, which never take plain http whatever the athlete allows. */
const HTTPS_ONLY_DOMAINS = ['intervals.icu', 'veloq.fit'];

const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq network security config: plain http only where the app's own address check allows it -->
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
 * Add an insecure-http exception for each home network suffix to an ATS
 * dictionary, with local networking on and everything else kept.
 */
function withPlainLanExceptions(ats = {}) {
  const exceptions = { ...(ats.NSExceptionDomains ?? {}) };
  for (const suffix of PLAIN_LAN_SUFFIXES) {
    exceptions[suffix] = {
      ...(exceptions[suffix] ?? {}),
      NSIncludesSubdomains: true,
      NSExceptionAllowsInsecureHTTPLoads: true,
    };
  }
  return {
    ...ats,
    NSAllowsLocalNetworking: true,
    NSExceptionDomains: exceptions,
  };
}

function withPlainLanTransport(config) {
  config = withAndroidManifest(config, async (mod) => {
    writeNetworkSecurityConfig(
      path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
    );
    configureManifest(AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults));
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSAppTransportSecurity = withPlainLanExceptions(
      mod.modResults.NSAppTransportSecurity
    );
    return mod;
  });

  return config;
}

module.exports = withPlainLanTransport;
module.exports.NETWORK_SECURITY_XML = NETWORK_SECURITY_XML;
module.exports.configureManifest = configureManifest;
module.exports.writeNetworkSecurityConfig = writeNetworkSecurityConfig;
module.exports.withPlainLanExceptions = withPlainLanExceptions;
