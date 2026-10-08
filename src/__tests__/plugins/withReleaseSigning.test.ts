/**
 * Scenario: the release key sits in `android/keystore.properties` on a machine
 * that builds production, and Veloq Dev is built there in release mode too.
 * Signed with the release key, a Dev release cannot replace a Dev debug
 * install, and the only way past a signature mismatch is an uninstall, which
 * wipes the library.
 *
 * Expected behaviour: the generated `build.gradle` signs a production release
 * with the release key when the file exists, and a Dev release with the debug
 * key whether it exists or not.
 */
import { execFileSync } from 'child_process';
import path from 'path';

type Mod = { modResults: { contents: string } };
type Config = { android?: { package?: string }; gradle?: string };

jest.mock('expo/config-plugins', () => ({
  ...jest.requireActual('expo/config-plugins'),
  withAppBuildGradle: (config: Config, action: (mod: Config & Mod) => Mod) => {
    config.gradle = action({
      ...config,
      modResults: { contents: config.gradle ?? '' },
    }).modResults.contents;
    return config;
  },
}));

const ROOT = path.join(__dirname, '../../..');
const withReleaseSigning = require('../../plugins/with-release-signing');
const appConfig = require('../../../app.config.js');
const appJson = require('../../../app.json');

// The app module's build file as Expo's own template generates it.
const TEMPLATE = execFileSync(
  'tar',
  ['-xzOf', path.join(ROOT, 'node_modules/expo/template.tgz'), 'package/android/app/build.gradle'],
  { encoding: 'utf8' }
);

function generated(variant: 'dev' | 'production'): string {
  const previous = process.env.APP_VARIANT;
  process.env.APP_VARIANT = variant;
  try {
    const config = appConfig({ config: { ...appJson.expo } });
    return withReleaseSigning({ ...config, gradle: TEMPLATE }).gradle;
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
}

/** The `signingConfig` line of the release build type. */
function releaseSigning(gradle: string): string | undefined {
  const types = gradle.slice(gradle.indexOf('buildTypes {'));
  const release = types.slice(types.indexOf('release {'));
  return release.match(/^\s*signingConfig (.+)$/m)?.[1];
}

describe('release signing', () => {
  it('signs a production release with the release key when keystore.properties exists', () => {
    const gradle = generated('production');

    expect(releaseSigning(gradle)).toBe(
      'keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug'
    );
    expect(gradle).toContain(
      'def keystorePropertiesFile = rootProject.file("keystore.properties")'
    );
  });

  it('signs a Dev release with the debug key, whatever keystore.properties holds', () => {
    const gradle = generated('dev');

    expect(releaseSigning(gradle)).toBe('signingConfigs.debug');
    expect(gradle).not.toContain('keystore.properties');
    expect(gradle).not.toContain('signingConfigs.release');
  });

  it('reads the template it is applied to', () => {
    expect(releaseSigning(TEMPLATE)).toBe('signingConfigs.debug');
  });
});
