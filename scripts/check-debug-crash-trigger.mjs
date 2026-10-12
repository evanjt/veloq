#!/usr/bin/env node

// Holds the forced render crash to debug native builds.
//
// The request is set on Android by a receiver in the debug source set and on
// iOS by a launch argument read inside `#if DEBUG`. Either one reaching a
// release build would let anything on the device, or any launch, put the app
// on its crash screen. So the receiver and the preferences it writes are named
// only under a `src/debug/` source set, the debug manifest exports the receiver
// for an explicit adb broadcast, and every native line naming the launch
// argument sits inside an `#if DEBUG` branch.
//
// Usage: node scripts/check-debug-crash-trigger.mjs [--root <dir>]

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { indexedSources } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root =
  rootFlag === -1
    ? join(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);

const debugManifest = 'modules/veloq-debug-crash/android/src/debug/AndroidManifest.xml';
const androidNames = ['DebugCrashReceiver', 'veloq_debug_crash'];
const launchArgument = 'VeloqForceRenderCrash';
const nativeSource = /\.(kt|java|xml|swift|m|mm|h|plist|pbxproj|xcscheme)$/;

const failures = [];
const sources = [...indexedSources(root, ['modules', 'android', 'ios', 'push', 'widget'])]
  .filter(([path]) => nativeSource.test(path))
  .map(([path, bytes]) => [path, bytes.toString('utf8')]);

for (const [path, text] of sources) {
  if (path.includes('/src/debug/')) continue;
  const named = androidNames.filter((name) => text.includes(name));
  if (named.length > 0) {
    failures.push(`${path} names ${named.join(', ')} outside a debug source set`);
  }
}

const debug = sources.find(([path]) => path === debugManifest)?.[1] ?? '';
if (
  !/<receiver\s+android:name="com\.veloq\.debugcrash\.DebugCrashReceiver"\s+android:exported="true"/.test(
    debug
  )
) {
  failures.push(
    `${debugManifest} does not declare an exported DebugCrashReceiver for an explicit adb broadcast`
  );
}

for (const [path, text] of sources) {
  outsideDebugBranch(text).forEach((line) =>
    failures.push(`${path}:${line} reads ${launchArgument} outside an #if DEBUG branch`)
  );
}

/**
 * The 1-based lines naming the launch argument where no `#if DEBUG` branch is
 * open. A comment line reads nothing, so it may name the argument anywhere.
 */
function outsideDebugBranch(text) {
  const lines = [];
  // One entry per open conditional: true while its branch is the DEBUG one.
  const open = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (/^#\s*if(def)?\b/.test(line)) {
      open.push(/^#\s*(if\s+DEBUG|ifdef\s+DEBUG)\b/.test(line));
    } else if (/^#\s*(else|elif)\b/.test(line)) {
      if (open.length > 0) open[open.length - 1] = false;
    } else if (/^#\s*endif\b/.test(line)) {
      open.pop();
    } else if (/^(\/\/|\/\*|\*)/.test(line)) {
      return;
    } else if (raw.includes(launchArgument) && !open.includes(true)) {
      lines.push(index + 1);
    }
  });
  return lines;
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
