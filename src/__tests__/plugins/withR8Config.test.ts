/**
 * Scenario: the R8 keep rules the prebuild writes into `proguard-rules.pro` name a package that no
 * Android source in the build declares. The rule keeps nothing, and it tells the next editor that
 * the package is covered when it is not.
 *
 * Expected behaviour: every keep rule the plugin writes for a package in the app's own namespace
 * (`com.veloq`, or `uniffi` for the bindings) names the application package or a package with a
 * source directory in the Android build.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Config = Record<string, unknown> & {
  modRequest?: { platformProjectRoot: string };
  dangerousActions?: Action[];
};
type Action = (config: Config) => Promise<Config>;

jest.mock('expo/config-plugins', () => {
  const actual = jest.requireActual('expo/config-plugins');
  return {
    ...actual,
    withGradleProperties: (config: Config) => config,
    withDangerousMod: (config: Config, [, action]: [string, Action]) => {
      config.dangerousActions = [...(config.dangerousActions ?? []), action];
      return config;
    },
  };
});

const withR8Config = require('../../plugins/with-r8-config');

const ROOT = path.join(__dirname, '../../..');
const APPLICATION_PACKAGE: string = require('../../../app.json').expo.android.package;
const ANDROID_SOURCE_ROOTS = ['modules/veloqrs/android/src', 'android/app/src'].map((dir) =>
  path.join(ROOT, dir)
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** The `proguard-rules.pro` a prebuild leaves behind, after every action the plugin registered. */
async function writtenProguardRules(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-r8-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'app'));
  const file = path.join(root, 'app', 'proguard-rules.pro');
  fs.writeFileSync(file, '# Project rules\n');

  const config: Config = { modRequest: { platformProjectRoot: root } };
  const planned = withR8Config(config) as Config;
  for (const action of planned.dangerousActions ?? []) await action(planned);

  return fs.readFileSync(file, 'utf8');
}

function keptPackages(rules: string): string[] {
  return [...rules.matchAll(/^-keep class ([\w.]+)\.\*\*/gm)].map((match) => match[1]);
}

function isOwnNamespace(pkg: string): boolean {
  return (
    pkg === 'com.veloq' ||
    pkg.startsWith('com.veloq.') ||
    pkg === 'uniffi' ||
    pkg.startsWith('uniffi.')
  );
}

/** True when some Android source set holds a directory for the package. */
function hasAndroidSources(pkg: string): boolean {
  const segments = pkg.split('.');
  return ANDROID_SOURCE_ROOTS.some(
    (root) =>
      fs.existsSync(root) &&
      fs.readdirSync(root).some((set) => fs.existsSync(path.join(root, set, 'java', ...segments)))
  );
}

describe('with-r8-config keep rules', () => {
  it('still writes the vendor keep rules, so the check below reads a real list', async () => {
    const kept = keptPackages(await writtenProguardRules());

    expect(kept).toContain('com.facebook.react');
    expect(kept).toContain('org.maplibre');
  });

  it('names only app packages the Android build declares', async () => {
    const owned = keptPackages(await writtenProguardRules()).filter(isOwnNamespace);

    const stale = owned.filter((pkg) => pkg !== APPLICATION_PACKAGE && !hasAndroidSources(pkg));
    expect(stale).toEqual([]);
  });
});
