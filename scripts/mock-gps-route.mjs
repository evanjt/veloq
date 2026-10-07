#!/usr/bin/env node
// Feeds a scripted ride to the handset's GPS so a live recording moves with no
// one riding. Invented loop of about 2 km at riding speed, one fix a second.
//
//   ANDROID_SERIAL=<serial> node scripts/mock-gps-route.mjs [seconds] [speed m/s]
//
// The test provider and the shell's mock-location appop are put back on exit,
// including SIGINT. Provider path: starts with the `gps` provider only. If the
// recording's distance stays at 0 after 30 s, the fused provider is not passing
// it through, so add `fused` and `network` providers the same way and record
// here which worked.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { routeFixes, setupCommands, fixCommand, cleanupCommands } from './lib/mock-gps-route.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

if (!process.env.VELOQ_DEVICE_LOCK_HELD) {
  const lock = join(SCRIPT_DIR, 'with-device-lock.sh');
  const relock = spawnSync(
    lock,
    [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  if (relock.error) {
    console.error(`mock-gps-route: could not run ${lock}: ${relock.error.message}`);
    process.exit(1);
  }
  process.exit(relock.status ?? 1);
}

const seconds = Number(process.argv[2] ?? 300);
const speed = Number(process.argv[3] ?? 8);
if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(speed) || speed <= 0) {
  console.error('usage: mock-gps-route.mjs [seconds] [speed m/s]');
  process.exit(2);
}

const adb = (args) => spawnSync('adb', args, { stdio: 'inherit' });

const attached = spawnSync('adb', ['devices'], { encoding: 'utf8' })
  .stdout.split('\n')
  .filter((line) => /\sdevice$/.test(line));
if (!process.env.ANDROID_SERIAL && attached.length !== 1) {
  console.error('mock-gps-route: set ANDROID_SERIAL, none or several devices are attached');
  process.exit(2);
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const command of cleanupCommands()) adb(command);
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

try {
  for (const command of setupCommands()) adb(command);
  const fixes = routeFixes({ lat: -33.85, lng: 151.2 }, speed, seconds);
  for (const fix of fixes) {
    adb(fixCommand(fix));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  cleanup();
}
