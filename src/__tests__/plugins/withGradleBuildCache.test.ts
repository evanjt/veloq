/**
 * Scenario: a native build after a regeneration with `--clean`, or after a
 * fresh `npm ci`, finds no task output of its own and recompiles every native
 * library and every Kotlin module from nothing.
 *
 * Expected behaviour: the `gradle.properties` this app's plugins generate on
 * top of Expo's template turns the Gradle build cache on, so those task
 * outputs come back from the cache in the Gradle user home, which every
 * checkout on the machine shares and which a regeneration does not delete.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

type Property = { type: string; key?: string; value?: string };
type Action = (mod: Record<string, unknown>) => { modResults: unknown };
type Config = Record<string, unknown> & { gradlePropertiesActions?: Action[] };

jest.mock('expo/config-plugins', () => {
  const actual = jest.requireActual('expo/config-plugins');
  const untouched = (config: Config) => config;
  return {
    ...actual,
    withGradleProperties: (config: Config, action: Action) => {
      config.gradlePropertiesActions = [...(config.gradlePropertiesActions ?? []), action];
      return config;
    },
    withAndroidManifest: untouched,
    withInfoPlist: untouched,
    withDangerousMod: untouched,
    withXcodeProject: untouched,
    withAppBuildGradle: untouched,
    withProjectBuildGradle: untouched,
    withMainActivity: untouched,
    withMainApplication: untouched,
    withEntitlementsPlist: untouched,
    withSettingsGradle: untouched,
    withStringsXml: untouched,
    withAndroidStyles: untouched,
    withAndroidColors: untouched,
    withPodfile: untouched,
  };
});

const { AndroidConfig } = jest.requireActual('expo/config-plugins');

const ROOT = join(__dirname, '../../..');

/** The `gradle.properties` a prebuild writes: Expo's template, then every plugin of this app. */
function generatedGradleProperties(): Property[] {
  const appJson = require('../../../app.json');
  let config: Config = require('../../../app.config.js')({ config: { ...appJson.expo } });
  for (const entry of config.plugins as (string | [string, unknown])[]) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (!name.startsWith('./src/plugins/')) continue;
    config = require(join(ROOT, name))(config);
  }

  const template = execFileSync(
    'tar',
    ['-xzOf', join(ROOT, 'node_modules/expo/template.tgz'), 'package/android/gradle.properties'],
    { encoding: 'utf8' }
  );
  let properties: Property[] = AndroidConfig.Properties.parsePropertiesFile(template);
  for (const action of config.gradlePropertiesActions ?? []) {
    properties = action({ ...config, modResults: properties }).modResults as Property[];
  }
  return properties;
}

function valuesOf(properties: Property[], key: string): (string | undefined)[] {
  return properties.filter((p) => p.type === 'property' && p.key === key).map((p) => p.value);
}

describe('the generated gradle.properties', () => {
  it('turns the Gradle build cache on', () => {
    expect(valuesOf(generatedGradleProperties(), 'org.gradle.caching')).toEqual(['true']);
  });

  it('turns it on once however often generation runs', () => {
    const { withBuildCacheProperty } = require('../../plugins/with-gradle-build-cache');
    const once = withBuildCacheProperty([]);
    expect(valuesOf(withBuildCacheProperty(once), 'org.gradle.caching')).toEqual(['true']);
  });

  it('replaces a property that turns it off', () => {
    const { withBuildCacheProperty } = require('../../plugins/with-gradle-build-cache');
    const off = [{ type: 'property', key: 'org.gradle.caching', value: 'false' }];
    expect(valuesOf(withBuildCacheProperty(off), 'org.gradle.caching')).toEqual(['true']);
  });

  it('keeps the parallel build and the heap the template and other plugins set', () => {
    const properties = generatedGradleProperties();
    expect(valuesOf(properties, 'org.gradle.parallel')).toEqual(['true']);
    expect(valuesOf(properties, 'org.gradle.jvmargs')).toEqual([
      '-Xmx4096m -XX:MaxMetaspaceSize=512m',
    ]);
  });
});
