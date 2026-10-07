#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const original = 'altitude = location.altitude,';
const replacement = 'altitude = if (location.hasAltitude()) location.altitude else null,';
const RELATIVE = 'android/src/main/java/expo/modules/location/records/LocationResults.kt';

/** Where the altitude line stands: `patched`, `unpatched`, or `changed` upstream. */
function altitudeState(source) {
  if (source.includes(replacement)) return 'patched';
  if (source.includes(original)) return 'unpatched';
  return 'changed';
}

function patchAltitude(source) {
  const state = altitudeState(source);
  if (state === 'patched') return source;
  if (state === 'changed') throw new Error('Expo location altitude constructor changed');
  return source.replace(original, replacement);
}

/** The Kotlin file `root` resolves expo-location to, or null when it is absent. */
function locationResults(root) {
  const target = path.join(root, 'node_modules', 'expo-location', RELATIVE);
  return fs.existsSync(target) ? target : null;
}

function applyPatch(root) {
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, 'expo-location');
  if (!fs.existsSync(entry)) return;
  // A whole-directory link reads the main checkout's copy, which is not this
  // tree's to write, so a patched one is fine and an unpatched one is refused.
  if (fs.lstatSync(modules).isSymbolicLink()) {
    const target = locationResults(root);
    if (target && altitudeState(fs.readFileSync(target, 'utf8')) === 'patched') return;
    throw new Error(
      `Expo location altitude is not patched in ${fs.realpathSync(modules)}. ` +
        'Run `node scripts/patch-expo-location.js` in the main checkout.'
    );
  }
  // Keep a worktree patch on its own disk, never on the shared dependency.
  if (fs.lstatSync(entry).isSymbolicLink()) {
    const copy = `${entry}.altitude-copy`;
    fs.cpSync(fs.realpathSync(entry), copy, { recursive: true });
    fs.unlinkSync(entry);
    fs.renameSync(copy, entry);
  }
  const target = path.join(entry, RELATIVE);
  fs.writeFileSync(target, patchAltitude(fs.readFileSync(target, 'utf8')));
}

if (require.main === module) applyPatch(process.cwd());

module.exports = { altitudeState, patchAltitude, applyPatch, locationResults };
