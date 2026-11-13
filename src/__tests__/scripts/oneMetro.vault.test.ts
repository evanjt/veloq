/**
 * Scenario: the React Native CLI plugin asks for Metro by a caret range, while
 * Expo pins the Metro it bundles with. A lockfile that resolves the range to a
 * second, older copy installs a bundler nothing in the build runs, and that
 * copy brings its own image parser, which reads asset dimensions with a parser
 * that loops for ever on a crafted image.
 *
 * Expected behaviour: both resolve to the one installed Metro, and that Metro
 * reads image dimensions itself rather than through `image-size`.
 */

import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(__dirname, '..', '..', '..');

function packageDir(name: string, from: string): string {
  return realpathSync(dirname(require.resolve(`${name}/package.json`, { paths: [from] })));
}

describe('the installed Metro', () => {
  const reactNative = packageDir('react-native', root);
  const cliPlugin = packageDir('@react-native/community-cli-plugin', reactNative);
  const expoMetro = packageDir('@expo/metro', packageDir('expo', root));

  it('is the same copy for the React Native CLI and for Expo', () => {
    expect(packageDir('metro', cliPlugin)).toBe(packageDir('metro', expoMetro));
  });

  it('does not depend on image-size', () => {
    const metro = require(join(packageDir('metro', expoMetro), 'package.json'));
    expect(Object.keys(metro.dependencies ?? {})).not.toContain('image-size');
  });
});
