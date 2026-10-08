#!/usr/bin/env node
// Feeds a scripted ride to the handset's GPS so a live recording moves with no
// one riding. Invented loop of about 2 km at riding speed, one fix a second.
//
//   ANDROID_SERIAL=<serial> node scripts/mock-gps-route.mjs [seconds] [speed m/s]
//
// The test provider and the shell's mock-location appop are put back on exit,
// including SIGINT. The `gps` test provider alone reaches the recording through
// the fused provider, measured on a handset. A Maestro flow starting removes the
// shell's test provider, so a refused fix restores it and is sent once more. The
// counts print on exit, and any fix still lost exits 1, so a run that moved
// nothing cannot read as a ride.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  routeFixes,
  setupCommands,
  fixCommand,
  cleanupCommands,
  providerIsGone,
  retryCommands,
} from './lib/mock-gps-route.mjs';

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
// `cmd location` can exit 0 while printing the refusal, so the output decides too.
const send = (args) => {
  const result = spawnSync('adb', args, { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { output, ok: !result.error && result.status === 0 && !providerIsGone(output) };
};

const attached = spawnSync('adb', ['devices'], { encoding: 'utf8' })
  .stdout.split('\n')
  .filter((line) => /\sdevice$/.test(line));
if (!process.env.ANDROID_SERIAL && attached.length !== 1) {
  console.error('mock-gps-route: set ANDROID_SERIAL, none or several devices are attached');
  process.exit(2);
}

const counts = { sent: 0, restored: 0, lost: 0 };
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const command of cleanupCommands()) adb(command);
  console.log(
    `mock-gps-route: ${counts.sent} fixes, provider restored ${counts.restored} times, ${counts.lost} lost`
  );
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
    counts.sent++;
    let result = send(fixCommand(fix));
    const retry = retryCommands(fix, result.output);
    if (retry.length > 0) {
      counts.restored++;
      for (const command of retry) result = send(command);
    }
    if (!result.ok) {
      counts.lost++;
      console.error(`mock-gps-route: fix ${fix.offsetSeconds} lost: ${result.output.trim()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  cleanup();
}
if (counts.lost > 0) process.exitCode = 1;
