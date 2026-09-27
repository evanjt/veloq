// The instant every suite starts at. A test that reads the clock with no fake
// timers of its own used to read the machine's, so a filler dated from today
// or a "this week" window moved under it and failed on some days only
// (feedIndicatorSweep, 2026-09-25). Midday UTC on a Wednesday in mid June is
// clear of a month end, a year end and every DST change, and still the same
// date in UTC and every zone west of UTC+12.
const FIXED_NOW = Date.parse('2026-06-17T12:00:00.000Z');

// Everything Jest can fake except `Date`, so the global default moves the date
// alone and every timer stays real.
const TIMERS_NOT_FAKED = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

module.exports = { FIXED_NOW, TIMERS_NOT_FAKED };
