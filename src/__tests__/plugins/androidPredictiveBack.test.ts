/**
 * Scenario: an athlete on Android 14 or later swipes back slowly from the root screen.
 *
 * Expected behaviour: the manifest prebuild generates opts the application in to predictive
 * back, so the system previews the destination and delivers back through the callback
 * dispatcher that React Native's back handling reads. Opting out is the deprecated path on a
 * targetSdk 36 build.
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

describe('the generated Android predictive back declaration', () => {
  it('opts the application in to the back invoked callback', async () => {
    const manifest = await generatedManifest();
    const applications = manifest.manifest.application ?? [];
    expect(applications).toHaveLength(1);
    expect(applications[0]!.$['android:enableOnBackInvokedCallback']).toBe('true');
  }, 60_000);
});
