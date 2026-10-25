#!/usr/bin/env node
// The Garmin Personal key's keychain item is named by the connector and the
// sign-out path alone.
//
// Any other file that names the item can read the key out, or write it
// somewhere the keychain options do not cover. The item name is a constant in
// the credential keychain module; this guard refuses a source file outside the
// allowed few that names the constant or the stored item name.
//
// Usage: node scripts/check-garmin-key-sites.mjs [--root DIR]

import { resolve } from 'node:path';

import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg < 0 ? '.' : process.argv[rootArg + 1]);

const ALLOWED = new Set([
  'src/shared/app/credentialKeychain.ts',
  'src/shared/app/AuthStore.ts',
  'src/features/settings/lib/garminConnector.ts',
  'src/features/settings/components/GarminConnector.tsx',
]);
const NAMES = /GARMIN_KEY_STORAGE_KEY|garmin_personal_key/;

const sources = treeSources(root, ['src']);
refuseEmptyListing(sources, 'source files under src');

const offenders = [...sources]
  .filter(([file]) => /\.[jt]sx?$/.test(file) && !file.includes('__tests__'))
  .filter(([file]) => !ALLOWED.has(file))
  .filter(([, bytes]) => NAMES.test(bytes.toString('utf8')))
  .map(([file]) => file);

if (offenders.length) {
  console.error(`The Garmin keychain item is named outside the connector: ${offenders.join(', ')}`);
  process.exit(1);
}
