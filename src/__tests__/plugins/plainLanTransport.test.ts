/**
 * Scenario: the athlete opts in to backing up to a plain-http WebDAV server on
 * their own network, and the form accepts the address. A debug build allows
 * cleartext to any host, so the backup works there, while a release build
 * carries only what its manifest and its App Transport Security dictionary
 * allow.
 *
 * Expected behaviour: the native config the app's own plugins generate on top
 * of Expo's template lets plain http through to every host the address check
 * accepts behind the opt-in, on both platforms, and keeps refusing it to a
 * public host.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AndroidConfig as AndroidConfigTypes } from 'expo/config-plugins';

import { webdavUrlProblem } from '@/features/settings/lib/autobackup/webdavConfig';
import PLAIN_LAN_SUFFIXES from '@/features/settings/lib/autobackup/plainLanSuffixes.json';

type Action = (
  mod: Record<string, unknown>
) => { modResults: unknown } | Promise<{ modResults: unknown }>;
type Config = Record<string, unknown> & {
  manifestActions?: Action[];
  infoPlistActions?: Action[];
};

jest.mock('expo/config-plugins', () => {
  const actual = jest.requireActual('expo/config-plugins');
  const queue =
    (key: 'manifestActions' | 'infoPlistActions') => (config: Config, action: Action) => {
      config[key] = [...(config[key] ?? []), action];
      return config;
    };
  const untouched = (config: Config) => config;
  return {
    ...actual,
    withAndroidManifest: queue('manifestActions'),
    withInfoPlist: queue('infoPlistActions'),
    withDangerousMod: untouched,
    withXcodeProject: untouched,
    withAppBuildGradle: untouched,
    withMainActivity: untouched,
    withEntitlementsPlist: untouched,
    withSettingsGradle: untouched,
    withGradleProperties: untouched,
  };
});

const { AndroidConfig } = jest.requireActual('expo/config-plugins');
const plist = require('@expo/plist').default;

type AndroidManifest = AndroidConfigTypes.Manifest.AndroidManifest;

const ROOT = join(__dirname, '../../..');
const TEMPLATE = join(ROOT, 'node_modules/expo/template.tgz');

function templateFile(entry: string): string {
  return execFileSync('tar', ['-xzOf', TEMPLATE, entry], { encoding: 'utf8' });
}

interface AtsDictionary {
  NSAllowsArbitraryLoads?: boolean;
  NSAllowsLocalNetworking?: boolean;
  NSExceptionDomains?: Record<string, Record<string, unknown>>;
}

interface Generated {
  manifest: AndroidManifest;
  resDir: string;
  infoPlist: { NSAppTransportSecurity?: AtsDictionary };
}

/** Run every plugin of this app's config over Expo's template, as a prebuild does. */
async function generate(variant: 'production' | 'dev'): Promise<Generated> {
  const previous = process.env.APP_VARIANT;
  process.env.APP_VARIANT = variant;
  let config: Config;
  try {
    const appJson = require('../../../app.json');
    config = require('../../../app.config.js')({ config: { ...appJson.expo } });
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
  for (const entry of config.plugins as (string | [string, unknown])[]) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (!name.startsWith('./src/plugins/')) continue;
    config = require(join(ROOT, name))(config);
  }

  const androidRoot = mkdtempSync(join(tmpdir(), 'plain-lan-android-'));
  const manifestPath = join(androidRoot, 'AndroidManifest.xml');
  writeFileSync(manifestPath, templateFile('package/android/app/src/main/AndroidManifest.xml'));
  let manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const modRequest = { projectRoot: ROOT, platformProjectRoot: androidRoot };
  for (const action of config.manifestActions ?? []) {
    manifest = (await action({ ...config, modRequest, modResults: manifest }))
      .modResults as AndroidManifest;
  }

  let infoPlist: Generated['infoPlist'] = plist.parse(
    templateFile('package/ios/HelloWorld/Info.plist')
  );
  for (const action of config.infoPlistActions ?? []) {
    infoPlist = (await action({ ...config, modRequest, modResults: infoPlist }))
      .modResults as Generated['infoPlist'];
  }

  return { manifest, resDir: join(androidRoot, 'app/src/main/res/xml'), infoPlist };
}

/**
 * Whether Android lets an http request to this host through, read the way the
 * platform reads it from API 28: the most specific matching domain-config, else
 * the base-config, else no cleartext.
 */
function androidCarriesHttp({ manifest, resDir }: Generated, host: string): boolean {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const reference: string | undefined = app.$['android:networkSecurityConfig'];
  if (!reference) return app.$['android:usesCleartextTraffic'] === 'true';
  const xml = readFileSync(join(resDir, `${reference.replace(/^@xml\//, '')}.xml`), 'utf8');

  let best: { length: number; permitted: boolean } | null = null;
  for (const [, attributes, body] of xml.matchAll(
    /<domain-config([^>]*)>([\s\S]*?)<\/domain-config>/g
  )) {
    const permitted = /cleartextTrafficPermitted="true"/.test(attributes!);
    for (const [, domainAttributes, domain] of body!.matchAll(
      /<domain([^>]*)>([^<]+)<\/domain>/g
    )) {
      const subdomains = /includeSubdomains="true"/.test(domainAttributes!);
      const matches = host === domain || (subdomains && host.endsWith(`.${domain}`));
      if (matches && (!best || domain!.length > best.length)) {
        best = { length: domain!.length, permitted };
      }
    }
  }
  if (best) return best.permitted;
  const base = xml.match(/<base-config([^>]*)>|<base-config([^>]*)\/>/);
  return base ? /cleartextTrafficPermitted="true"/.test(base[1] ?? base[2] ?? '') : false;
}

/**
 * Whether App Transport Security lets an http request to this host through: a
 * matching exception domain decides, else local networking covers IP literals,
 * unqualified names and `.local`, and arbitrary loads are ignored beside it.
 */
function iosCarriesHttp({ infoPlist }: Generated, host: string): boolean {
  const ats = infoPlist.NSAppTransportSecurity ?? {};
  const exceptions: Record<string, Record<string, unknown>> = ats.NSExceptionDomains ?? {};
  const domain = Object.keys(exceptions)
    .filter(
      (key) =>
        host === key || (exceptions[key]!.NSIncludesSubdomains === true && host.endsWith(`.${key}`))
    )
    .sort((a, b) => b.length - a.length)[0];
  if (domain) return exceptions[domain]!.NSExceptionAllowsInsecureHTTPLoads === true;
  const local =
    host.startsWith('[') || /^[\d.]+$/.test(host) || !host.includes('.') || host.endsWith('.local');
  if (ats.NSAllowsLocalNetworking === true) return local;
  return ats.NSAllowsArbitraryLoads === true;
}

const ACCEPTED_HOSTS = [
  '192.168.1.20',
  '10.0.0.5',
  '172.16.0.9',
  '127.0.0.1',
  'localhost',
  '[::1]',
  '[fe80::1]',
  '[fd12::5]',
  ...PLAIN_LAN_SUFFIXES.flatMap((suffix) => [`nas.${suffix}`, `files.attic.${suffix}`]),
];

describe.each(['production', 'dev'] as const)('the %s release transport', (variant) => {
  let generated: Generated;
  beforeAll(async () => {
    generated = await generate(variant);
  });

  it.each(ACCEPTED_HOSTS)('carries plain http to %s on Android', (host) => {
    expect(webdavUrlProblem(`http://${host}/dav`, true)).toBeNull();
    expect(androidCarriesHttp(generated, host)).toBe(true);
  });

  it.each(ACCEPTED_HOSTS)('carries plain http to %s on iOS', (host) => {
    expect(webdavUrlProblem(`http://${host}/dav`, true)).toBeNull();
    expect(iosCarriesHttp(generated, host)).toBe(true);
  });

  it('keeps plain http off the athlete data source and the sign-in proxy on Android', () => {
    for (const host of ['intervals.icu', 'auth.veloq.fit']) {
      expect(androidCarriesHttp(generated, host)).toBe(false);
    }
  });

  it('keeps refusing plain http to a public host on iOS', () => {
    for (const host of ['cloud.example.com', 'intervals.icu', 'nas.lan.example.com']) {
      expect(iosCarriesHttp(generated, host)).toBe(false);
    }
    expect(generated.infoPlist.NSAppTransportSecurity?.NSAllowsArbitraryLoads).toBe(false);
  });
});

describe('with-plain-lan-transport', () => {
  const {
    NETWORK_SECURITY_XML,
    writeNetworkSecurityConfig,
    withPlainLanExceptions,
  } = require('../../plugins/with-plain-lan-transport');

  it('keeps an exception domain it does not own and the settings beside it', () => {
    const ats = withPlainLanExceptions({
      NSAllowsArbitraryLoads: false,
      NSExceptionDomains: { 'orchard.example': { NSExceptionMinimumTLSVersion: 'TLSv1.2' } },
    });

    expect(ats.NSAllowsArbitraryLoads).toBe(false);
    expect(ats.NSAllowsLocalNetworking).toBe(true);
    expect(ats.NSExceptionDomains['orchard.example']).toEqual({
      NSExceptionMinimumTLSVersion: 'TLSv1.2',
    });
    expect(ats.NSExceptionDomains.lan).toEqual({
      NSIncludesSubdomains: true,
      NSExceptionAllowsInsecureHTTPLoads: true,
    });
  });

  it('starts an ATS dictionary when the Info.plist has none', () => {
    const ats = withPlainLanExceptions(undefined);

    expect(Object.keys(ats.NSExceptionDomains).sort()).toEqual([...PLAIN_LAN_SUFFIXES].sort());
  });

  it('rewrites the network security config a previous prebuild left', () => {
    const resDir = join(mkdtempSync(join(tmpdir(), 'plain-lan-res-')), 'res', 'xml');

    writeNetworkSecurityConfig(resDir);
    writeFileSync(join(resDir, 'veloq_network_security_config.xml'), '<stale />');
    writeNetworkSecurityConfig(resDir);

    expect(readFileSync(join(resDir, 'veloq_network_security_config.xml'), 'utf8')).toBe(
      NETWORK_SECURITY_XML
    );
  });
});
