/**
 * Scenario: Android pins a window to 60 Hz unless the app asks for more, so on a
 * 120 Hz panel that does not raise the rate itself every scroll and map pan
 * runs at half the rate. The request used to live in a hand-kept
 * `MainActivity.kt`, which Expo generation replaces with its template.
 *
 * Expected behaviour: the request is an activity lifecycle package in a local
 * module, and Expo autolinking finds it for the generated Android project.
 * Autolinking finds a package only by a file named `*Package.kt` that imports
 * expo's `Package` interface, so a rename that breaks either drops the request
 * with nothing failing at build time.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const ROOT = join(__dirname, '../../..');

type Resolved = {
  modules: { packageName: string; projects?: { packages: string[] }[] }[];
};

function androidPackages(): string[] {
  const autolinking = dirname(
    require.resolve('expo-modules-autolinking/package.json', {
      paths: [dirname(require.resolve('expo/package.json', { paths: [ROOT] }))],
    })
  );
  const output = execFileSync(
    'node',
    [
      join(autolinking, 'bin/expo-modules-autolinking.js'),
      'resolve',
      '--platform',
      'android',
      '--json',
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );
  const resolved = JSON.parse(output) as Resolved;
  return resolved.modules.flatMap((module) =>
    (module.projects ?? []).flatMap((project) => project.packages)
  );
}

it('links the highest refresh rate request into the generated Android project', () => {
  expect(androidPackages()).toContain('com.veloq.display.VeloqDisplayPackage');
});
