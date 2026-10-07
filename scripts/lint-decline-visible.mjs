#!/usr/bin/env node
// A job that declines has to say why at a level a device shows.
//
// The engine's `.so` is built `--release` for every APK variant, debug
// included (`modules/veloqrs/android/build.gradle`), and `log_level()` keys off
// `debug_assertions`, so a handset logs at `Warn`. Every line below `warn` is
// compiled in and then dropped at runtime, which is why `adb logcat -s veloqrs`
// on a real phone returns nothing at all.
//
// That is only a problem for the lines that say a job refused to start. A
// running commentary belongs at `info` and stays there; "deferred: paused" is
// the whole answer to why a queue has not moved in a fortnight, and an engine
// that will not say it out loud cannot be diagnosed with the phone in hand.
//
// So: the decline sites listed here log at `warn` or above. The list is
// deliberately explicit rather than a pattern over every `deferred`, because a
// guard that promotes every log in the crate would bury the ones that matter.

import { treeSources } from './lib/indexedSources.mjs';

/** Every site that answers "why did this not run", by the text it logs. */
const ELEVATION = 'modules/veloqrs/rust/veloqrs/src/net/elevation_backfill.rs';
const DETECTION = 'modules/veloqrs/rust/veloqrs/src/objects/detection.rs';

// The native push worker's silent outcomes. Each one is the whole answer to
// "why does the tray hold only the placeholder", and the worker runs in a
// process with no JavaScript, so logcat was the only place they could go.
const PUSH = 'modules/veloqrs/rust/veloqrs/src/push/mod.rs';
const PUSH_JNI = 'modules/veloqrs/rust/veloqrs/src/push/jni.rs';

const DECLINES = [
  { file: DETECTION, text: 'Start refused:' },
  { file: DETECTION, text: 'Force redetect refused:' },
  { file: ELEVATION, text: 'backfill deferred: queue unreadable' },
  { file: ELEVATION, text: 'backfill deferred: a pass already holds the slot' },
  { file: ELEVATION, text: 'backfill deferred: paused' },
  { file: ELEVATION, text: 'backfill deferred: offline' },
  { file: ELEVATION, text: 'backfill deferred: no credential yet' },
  { file: ELEVATION, text: 'refused, worth asking again' },
  { file: PUSH, text: 'notifications are off, leaving' },
  { file: PUSH, text: 'no string bundle yet for' },
  { file: PUSH, text: 'the ladder found nothing for' },
  { file: PUSH_JNI, text: 'nothing to post for' },
];

// `lock-trace` is the other case, and it is not a decline. The feature exists
// so the engine lock can be "measured rather than argued about", and it is
// compiled only when someone asks for it, so there is no running commentary to
// bury: every line it emits is the measurement. At `info` the whole per-site
// table reached nobody on the one platform the argument is about.
const LOCK_TRACE = 'modules/veloqrs/rust/veloqrs/src/persistence/lock_trace.rs';

const MEASUREMENTS = [
  { file: LOCK_TRACE, text: '[LockTrace] slow' },
  { file: LOCK_TRACE, text: '[LockTrace] summary' },
  { file: LOCK_TRACE, text: '[LockTrace] hold' },
  { file: LOCK_TRACE, text: '[LockTrace] calls' },
  { file: LOCK_TRACE, text: '[LockTrace] wait' },
];

const offenders = [];
const missing = [];

for (const { file, text } of [...DECLINES, ...MEASUREMENTS]) {
  const bytes = treeSources(process.cwd(), [file]).get(file);
  const source = bytes === undefined ? '' : bytes.toString('utf8');
  const lines = source.split('\n');
  const at = lines.findIndex((line) => line.includes(text));
  if (at === -1) {
    missing.push({ file, text });
    continue;
  }
  // The macro may open a line or two above the message when the call wraps.
  const window = lines.slice(Math.max(0, at - 3), at + 1).join('\n');
  if (!/log::(warn|error)!/.test(window)) {
    offenders.push({ file, line: at + 1, text });
  }
}

if (missing.length > 0) {
  console.error('A line this guard names no longer exists. Update the list or the site.\n');
  for (const { file, text } of missing) console.error(`  ${file}: "${text}"`);
  process.exit(1);
}

if (offenders.length > 0) {
  console.error('These must log at warn or above, or a device never shows them.\n');
  for (const { file, line, text } of offenders) console.error(`  ${file}:${line}  "${text}"`);
  console.error(
    '\nThe engine logs at Warn on every device build, so info here reaches nobody with\n' +
      'the phone in hand. Promote the line, or take the message off the list.'
  );
  process.exit(1);
}

console.log(
  `Device log visibility: ${DECLINES.length} declines and ${MEASUREMENTS.length} lock-trace lines log at warn or above.`
);
