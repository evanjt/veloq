#!/usr/bin/env node
// Every script under `scripts/` and `.maestro/` that drives the handset takes the device lock,
// and every Maestro call under `scripts/` goes through `with-maestro.sh`.
//
// The lock exists because a flow's `launchApp` force-stops the app and an
// install kills it, so two sessions on one phone ruin each other's
// measurements without either run saying so. The drivers were a list kept by
// hand in a test, so a script nobody added to it passed whatever it did, and
// `install-apk.sh` sat off the list from the day it was written.
//
// Maestro bare is the second half. It chooses a transport itself and does not
// honour `ANDROID_SERIAL`, so a script that takes the lock on one phone and runs
// `maestro test` can drive the other: `adb` reaches the locked phone and the
// flow lands on whichever transport Maestro enumerates first. The wrapper pins
// the serial the lock was taken on and checks where the run landed.
//
// An invocation is a command, not a mention: comments and the text of a
// message are left out, and so is `command -v`. The lock machinery reads
// `adb devices` to choose which lock to take, so it is not a driver.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { indexedSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? resolve(HERE, '..') : resolve(process.argv[rootFlag + 1]);

const LOCK_MACHINERY = new Set([
  'scripts/with-device-lock.sh',
  'scripts/device-lock-shell.sh',
  'scripts/device-lock-path.sh',
  'scripts/device-lock-handset.sh',
]);
const WRAPPER = 'scripts/with-maestro.sh';

const SHELL = /\.(sh|bash)$/;
const NODE = /\.(mjs|cjs|js|ts)$/;

/** A shell line with its comment and its echoed or printed text taken out. */
function shellCode(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return '';
  if (/^(echo|printf)\b/.test(trimmed)) return '';
  return line.replace(/(^|\s)#.*$/, '').replace(/command -v \S+/g, '');
}

/** JavaScript with its comments taken out. */
function nodeCode(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const SHELL_ADB = /(^|[\s;&|(`]|\$\()("?\$\{?ADB\}?"?|adb)\s+[-a-z"$]/;
const SHELL_MAESTRO = /(^|[\s;&|(`]|\$\()maestro\s+[-a-z"$]/;
const SHELL_MAESTRO_VAR = /(^|[\s;&|(`]|\$\()"?\$\{?MAESTRO\}?"?\s+[-a-z"$]/;
// A script that names the wrapper `MAESTRO` calls the wrapper through it.
const MAESTRO_IS_WRAPPER = /^\s*MAESTRO=.*with-maestro\.sh/m;
// A command string handed to `child_process`, not a message that starts with the word.
const NODE_CALL = String.raw`\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\(\s*[\x60'"]`;
const NODE_ADB = new RegExp(`${NODE_CALL}adb\\b`);
const NODE_MAESTRO = new RegExp(`${NODE_CALL}maestro\\b`);

/** What a script invokes: `adb`, Maestro, both or neither. */
export function invocations(file, source) {
  if (SHELL.test(file)) {
    const lines = source.split('\n').map(shellCode);
    const viaVariable =
      !MAESTRO_IS_WRAPPER.test(source) && lines.some((l) => SHELL_MAESTRO_VAR.test(l));
    return {
      adb: lines.some((l) => SHELL_ADB.test(l)),
      maestro: viaVariable || lines.some((l) => SHELL_MAESTRO.test(l)),
    };
  }
  if (NODE.test(file)) {
    const code = nodeCode(source);
    return { adb: NODE_ADB.test(code), maestro: NODE_MAESTRO.test(code) };
  }
  return { adb: false, maestro: false };
}

/** Whether a script re-execs through the device lock unless it already holds it. */
export function takesTheLock(source) {
  return source.includes('with-device-lock.sh') && source.includes('VELOQ_DEVICE_LOCK_HELD');
}

function main() {
  const sources = indexedSources(ROOT, ['scripts', '.maestro']);
  const unlocked = [];
  const bare = [];
  let drivers = 0;

  for (const [file, bytes] of sources) {
    if (LOCK_MACHINERY.has(file)) continue;
    const source = bytes.toString('utf8');
    const { adb, maestro } = invocations(file, source);
    if (!adb && !maestro) continue;
    drivers += 1;
    if (!takesTheLock(source)) unlocked.push(file);
    if (maestro && file !== WRAPPER && file.startsWith('scripts/')) bare.push(file);
  }

  if (unlocked.length > 0) {
    console.error('A script drives the handset without taking the device lock:');
    for (const file of unlocked.sort()) console.error(`  ${file}`);
    console.error('\nRe-exec through scripts/with-device-lock.sh unless VELOQ_DEVICE_LOCK_HELD');
    console.error('is set, the way scripts/install-apk.sh does. An install or a launchApp');
    console.error('kills whatever another session is measuring on the same phone.');
  }
  if (bare.length > 0) {
    if (unlocked.length > 0) console.error('');
    console.error('A script runs Maestro without scripts/with-maestro.sh:');
    for (const file of bare.sort()) console.error(`  ${file}`);
    console.error('\nMaestro chooses its own transport, so a bare call can drive a phone the');
    console.error('lock was not taken on. The wrapper pins the locked serial and checks it.');
  }
  if (unlocked.length > 0 || bare.length > 0) process.exit(1);

  console.log(`device driver guard: ${drivers} scripts drive the handset, all under the lock.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
