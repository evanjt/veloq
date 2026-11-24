/**
 * Scenario: an athlete on Android 13 to 15 presses system back on activity detail, or holds a
 * slow back swipe at the feed.
 *
 * Expected behaviour: the manifest prebuild generates declares the application with
 * `enableOnBackInvokedCallback="false"`, so back reaches React Native through `onBackPressed`
 * and the app stays in front when a screen pops. No config plugin adds a back callback to
 * `MainActivity`. The system draws its back-to-home preview only while no back callback is
 * enabled on the window, so an opt-in does not draw one by itself: it only moves back off
 * `onBackPressed` and onto the dispatcher, where a stack pop is not handled.
 */

import path from 'path';

const projectRoot = path.join(__dirname, '../../..');

type Manifest = {
  manifest: { application?: { $: Record<string, string> }[] };
};

/** The AndroidManifest prebuild generates from the real config, read without writing `android/`. */
async function generatedManifest(): Promise<Manifest> {
  const expo = require.resolve('expo/package.json', { paths: [projectRoot] });
  const { getPrebuildConfigAsync } = require(
    require.resolve('@expo/prebuild-config', { paths: [expo] })
  );
  const { compileModsAsync } = require('expo/config-plugins');
  const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: ['android'] });
  const compiled = await compileModsAsync(exp, {
    projectRoot,
    introspect: true,
    platforms: ['android'],
    assertMissingModProviders: false,
  });
  return compiled._internal.modResults.android.manifest;
}

describe('the generated Android back declaration', () => {
  it('opts the application out of the back invoked callback', async () => {
    const manifest = await generatedManifest();
    const applications = manifest.manifest.application ?? [];
    expect(applications).toHaveLength(1);
    expect(applications[0]!.$['android:enableOnBackInvokedCallback']).toBe('false');
  }, 60_000);
});

describe('the app config', () => {
  const variant = process.env.APP_VARIANT;

  afterEach(() => {
    if (variant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = variant;
  });

  it.each(['production', 'dev'])('adds no back callback plugin on the %s identity', (identity) => {
    process.env.APP_VARIANT = identity;
    const appJson = require('../../../app.json');
    const appConfig = require('../../../app.config.js');

    const config = appConfig({ config: appJson.expo });

    expect(config.plugins).not.toContain('./src/plugins/with-android-back-callback');
  });
});
