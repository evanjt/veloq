#!/usr/bin/env node
// Every copy of the release version must agree with the app's. The engine
// stamps its exports with its crate version, so the crate and its lock entry
// are copies too, and the store builds take their version name from app.json.
// Both stores refuse a build number they have already seen, so the iOS build
// number and the Android version code move together.
import { resolve } from 'node:path';

import { trackedText } from './lib/indexedSources.mjs';

const root = resolve(process.argv[2] ?? '.');
const version = (file) => JSON.parse(trackedText(root, file)).version;

/** The `version` line of the package block naming `name`, or undefined. */
function cargoVersion(text, name) {
  if (text === undefined) return undefined;
  for (const block of text.split(/^\[\[?package\]\]?\s*$/m).slice(1)) {
    const body = block.split(/^\[/m)[0];
    const declared = body.match(/^name\s*=\s*"([^"]*)"/m)?.[1];
    if (declared !== undefined && declared !== name) continue;
    const found = body.match(/^version\s*=\s*"([^"]*)"/m)?.[1];
    if (found) return found;
  }
  return undefined;
}

const app = version('package.json');
const module = version('modules/veloqrs/package.json');
const lock = JSON.parse(trackedText(root, 'package-lock.json'));
const lockedModule = lock.packages?.['modules/veloqrs']?.version;
const crate = cargoVersion(trackedText(root, 'modules/veloqrs/rust/veloqrs/Cargo.toml'), 'veloqrs');
const lockedCrate = cargoVersion(trackedText(root, 'modules/veloqrs/rust/Cargo.lock'), 'veloqrs');
if ([module, lockedModule, crate, lockedCrate].some((v) => v !== app)) {
  console.error(
    `check-module-version: veloqrs version ${module}, lock version ${lockedModule}, ` +
      `crate version ${crate}, crate lock version ${lockedCrate}, app version ${app} differ`
  );
  process.exit(1);
}

const expo = JSON.parse(trackedText(root, 'app.json')).expo;
const buildNumber = expo?.ios?.buildNumber;
const versionCode = expo?.android?.versionCode;
if (expo?.version !== app) {
  console.error(
    `check-module-version: app.json version ${expo?.version}, app version ${app} differ`
  );
  process.exit(1);
}
if (!Number.isInteger(versionCode) || buildNumber !== String(versionCode)) {
  console.error(
    `check-module-version: iOS build number ${buildNumber}, ` +
      `Android version code ${versionCode} differ`
  );
  process.exit(1);
}
console.log(`check-module-version: ${app} (${versionCode})`);
