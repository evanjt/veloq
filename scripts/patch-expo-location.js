#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const original = 'altitude = location.altitude,';
const replacement = 'altitude = if (location.hasAltitude()) location.altitude else null,';

function patchAltitude(source) {
  if (source.includes(replacement)) return source;
  if (!source.includes(original)) throw new Error('Expo location altitude constructor changed');
  return source.replace(original, replacement);
}

function applyPatch(root) {
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, 'expo-location');
  if (!fs.existsSync(entry)) return;
  if (fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Expo location patch needs per-entry worktree module links');
  }
  // Keep a worktree patch on its own disk, never on the shared dependency.
  if (fs.lstatSync(entry).isSymbolicLink()) {
    const copy = `${entry}.altitude-copy`;
    fs.cpSync(fs.realpathSync(entry), copy, { recursive: true });
    fs.unlinkSync(entry);
    fs.renameSync(copy, entry);
  }
  const target = path.join(entry, 'android/src/main/java/expo/modules/location/records/LocationResults.kt');
  fs.writeFileSync(target, patchAltitude(fs.readFileSync(target, 'utf8')));
}

if (require.main === module) applyPatch(process.cwd());

module.exports = { patchAltitude, applyPatch };
