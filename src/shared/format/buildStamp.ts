/**
 * The version line under the settings footer.
 *
 * `app.config.js` stamps the commit into `extra.buildCommit` and
 * expo-constants regenerates that on every native build, so the phone names
 * what it runs rather than only which version it claims to be. A build off a
 * dirty tree adds `+` and the start of the hash of its inputs, so two builds
 * off different edits read differently. A build made outside a checkout
 * carries no stamp.
 */

import Constants from 'expo-constants';

export function buildCommit(): string | undefined {
  const stamp = Constants.expoConfig?.extra?.buildCommit;
  return typeof stamp === 'string' && stamp !== '' ? stamp : undefined;
}

export function formatVersionLine(version: string, commit: string | undefined): string {
  return commit ? `${version} (${commit})` : version;
}
