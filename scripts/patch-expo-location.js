#!/usr/bin/env node
// Android reports a fix's altitude above the WGS84 ellipsoid and iOS above mean
// sea level, so expo-location is patched to hand JavaScript the sea-level one on
// both. Each fix is converted off the main thread before it is mapped, and a fix
// with no sea-level altitude reports none. The conversion lives in
// `expo-location/SeaLevelAltitude.kt` beside this script.
const fs = require('fs');
const path = require('path');

const SOURCE = 'android/src/main/java/expo/modules/location';
const RESULTS = `${SOURCE}/records/LocationResults.kt`;
const HELPER = `${SOURCE}/records/SeaLevelAltitude.kt`;
const HELPER_SOURCE = path.join(__dirname, 'expo-location', 'SeaLevelAltitude.kt');
const SEA_LEVEL = 'expo.modules.location.records.SeaLevelAltitude';

/**
 * Every edit, by file: the line upstream carries, any line an earlier patch
 * left in its place, and the line it becomes.
 */
const EDITS = [
  {
    file: 'android/build.gradle',
    from: ["  api 'com.google.android.gms:play-services-location:21.0.1'\n"],
    to:
      "  api 'com.google.android.gms:play-services-location:21.0.1'\n" +
      "  implementation 'androidx.core:core:1.13.1'\n" +
      "  implementation 'androidx.core:core-location-altitude:1.0.0'\n",
  },
  {
    file: RESULTS,
    from: [
      '    altitude = location.altitude,\n',
      '    altitude = if (location.hasAltitude()) location.altitude else null,\n',
    ],
    to: '    altitude = SeaLevelAltitude.of(location),\n',
  },
  {
    file: RESULTS,
    from: ['          altitude = location.altitude\n'],
    to: '          altitude = SeaLevelAltitude.of(location)\n',
  },
  {
    file: `${SOURCE}/LocationModule.kt`,
    from: ['          callbacks.onLocationChanged(location)\n'],
    to: `          ${SEA_LEVEL}.add(mContext, listOf(location)) { callbacks.onLocationChanged(location) }\n`,
  },
  {
    file: `${SOURCE}/taskConsumers/LocationTaskConsumer.kt`,
    from: ['      handleLocationUpdate(result.locations)\n'],
    to: `      ${SEA_LEVEL}.add(context, result.locations) { if (mTask != null) handleLocationUpdate(it) }\n`,
  },
  {
    file: `${SOURCE}/taskConsumers/LocationTaskConsumer.kt`,
    from: ['          task.result?.let { handleLocationUpdate(listOf(it)) }\n'],
    to:
      '          task.result?.let {\n' +
      `            ${SEA_LEVEL}.add(context, listOf(it)) { fixes -> if (mTask != null) handleLocationUpdate(fixes) }\n` +
      '          }\n',
  },
];

/** Where one edit stands in `source`: `patched`, `unpatched`, or `changed` upstream. */
function editState(source, edit) {
  if (source.includes(edit.to)) return 'patched';
  if (edit.from.some((line) => source.split(line).length === 2)) return 'unpatched';
  return 'changed';
}

/**
 * Where the package at `pkg` stands: `patched` when every edit and the helper
 * are in place, `changed` naming the first file upstream rewrote, else `unpatched`.
 */
function locationState(pkg) {
  let state = 'patched';
  for (const edit of EDITS) {
    const target = path.join(pkg, edit.file);
    const found = fs.existsSync(target)
      ? editState(fs.readFileSync(target, 'utf8'), edit)
      : 'changed';
    if (found === 'changed') return { state: 'changed', file: target };
    if (found === 'unpatched') state = 'unpatched';
  }
  const helper = path.join(pkg, HELPER);
  const installed = fs.existsSync(helper) && fs.readFileSync(helper, 'utf8');
  if (installed !== fs.readFileSync(HELPER_SOURCE, 'utf8')) state = 'unpatched';
  return { state, file: path.join(pkg, RESULTS) };
}

/** Rewrites the package at `pkg` in place, or nothing when upstream changed a line. */
function patchPackage(pkg) {
  const { state, file } = locationState(pkg);
  if (state === 'changed') throw new Error(`expo-location changed the line patched in ${file}`);
  for (const edit of EDITS) {
    const target = path.join(pkg, edit.file);
    const source = fs.readFileSync(target, 'utf8');
    if (editState(source, edit) === 'patched') continue;
    const line = edit.from.find((candidate) => source.includes(candidate));
    fs.writeFileSync(target, source.replace(line, edit.to));
  }
  fs.copyFileSync(HELPER_SOURCE, path.join(pkg, HELPER));
}

/** The expo-location package `root` resolves, or null when it is absent. */
function locationPackage(root) {
  const pkg = path.join(root, 'node_modules', 'expo-location');
  return fs.existsSync(pkg) ? pkg : null;
}

function applyPatch(root) {
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, 'expo-location');
  if (!fs.existsSync(entry)) return;
  // A whole-directory link reads the main checkout's copy, which is not this
  // tree's to write, so a patched one is fine and an unpatched one is refused.
  if (fs.lstatSync(modules).isSymbolicLink()) {
    if (locationState(entry).state === 'patched') return;
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
  patchPackage(entry);
}

if (require.main === module) applyPatch(process.cwd());

module.exports = { applyPatch, locationPackage, locationState };
