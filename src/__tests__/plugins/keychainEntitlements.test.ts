/**
 * Scenario: an App Store provisioning profile grants `keychain-access-groups`
 * only under the team prefix, so a bare group id there fails signing. The
 * shared credential group is the App Group, which iOS already counts as an
 * access group for every target that declares it.
 *
 * Expected behaviour: no generated or tracked entitlement carries a bare
 * `keychain-access-groups` entry, and the group the credentials use is an App
 * Group each target declares.
 */

import fs from 'fs';
import path from 'path';

import { KEYCHAIN_ACCESS_GROUP } from '@/shared/app/credentialKeychain';

const ROOT = path.join(__dirname, '../../..');
const KEYCHAIN_KEY = 'keychain-access-groups';
const APP_GROUPS_KEY = 'com.apple.security.application-groups';

type Config = { entitlements?: Record<string, unknown> };
type Mod = { modResults: Record<string, unknown> };

jest.mock('expo/config-plugins', () => ({
  ...jest.requireActual('expo/config-plugins'),
  withEntitlementsPlist: (config: Config, action: (mod: Mod) => Mod) => {
    config.entitlements = action({ modResults: config.entitlements ?? {} }).modResults;
    return config;
  },
  withXcodeProject: (config: Config) => config,
  withDangerousMod: (config: Config) => config,
  withInfoPlist: (config: Config) => config,
  withAppDelegate: (config: Config) => config,
  withPlugins: (config: Config) => config,
  IOSConfig: {},
}));

function appEntitlements(): Record<string, unknown> {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  let config: Config = { entitlements: {} };
  for (const entry of app.expo.plugins) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name !== 'string' || !name.startsWith('./src/plugins/')) continue;
    if (!/with-app-groups|with-keychain/.test(name)) continue;
    config = require(path.join(ROOT, name))(config);
  }
  return config.entitlements ?? {};
}

function trackedEntitlementFiles(): string[] {
  const found: string[] = [];
  for (const dir of ['push', 'widget']) {
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.entitlements')) found.push(p);
      }
    };
    walk(path.join(ROOT, dir));
  }
  return found;
}

const teamPrefixed = (group: string) => /^\$\(AppIdentifierPrefix\)|^[A-Z0-9]{10}\./.test(group);

describe('keychain entitlements', () => {
  it('the app declares no bare keychain access group', () => {
    const groups = (appEntitlements()[KEYCHAIN_KEY] as string[] | undefined) ?? [];
    expect(groups.filter((g) => !teamPrefixed(g))).toEqual([]);
  });

  it.each(trackedEntitlementFiles())('%s declares no bare keychain access group', (file) => {
    const xml = fs.readFileSync(file, 'utf8');
    const block = xml.match(/<key>keychain-access-groups<\/key>\s*<array>([\s\S]*?)<\/array>/);
    const groups = block ? [...block[1].matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]) : [];
    expect(groups.filter((g) => !teamPrefixed(g))).toEqual([]);
  });

  it('the credential group is an App Group the app and the extension both declare', () => {
    expect(appEntitlements()[APP_GROUPS_KEY]).toContain(KEYCHAIN_ACCESS_GROUP);
    const ext = fs.readFileSync(
      path.join(ROOT, 'push/ios/VeloqPushExtension/VeloqPushExtension.entitlements'),
      'utf8'
    );
    const block = ext.match(
      /<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/
    );
    expect(block?.[1]).toContain(`<string>${KEYCHAIN_ACCESS_GROUP}</string>`);
  });
});
