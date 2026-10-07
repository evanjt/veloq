#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { indexedSources } from './lib/indexedSources.mjs';

const roots = ['modules/veloqrs/android/src', 'android/app/src'];
const debugManifest = 'modules/veloqrs/android/src/debug/AndroidManifest.xml';
const receiver = 'com.veloq.DebugPushReceiver';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = indexedSources(root, roots);
const manifests = [...sources.entries()].filter(([path]) => path.endsWith('/AndroidManifest.xml'));
const misplaced = manifests.filter(
  ([path, content]) => path !== debugManifest && content.toString('utf8').includes(receiver)
);
if (misplaced.length > 0) {
  console.error(`Debug push receiver appears outside the debug manifest: ${misplaced.map(([path]) => path).join(', ')}`);
  process.exitCode = 1;
}

const debug = sources.get(debugManifest)?.toString('utf8') ?? '';
if (!/<receiver\s+android:name="com\.veloq\.DebugPushReceiver"\s+android:exported="true"/.test(debug)) {
  console.error('Debug push receiver is missing or cannot accept an explicit adb broadcast');
  process.exitCode = 1;
}
