#!/usr/bin/env node
// Measures how often the feed's first preview cards are already among the
// newest five activities the first-use step readies, against the real library.
//
// On a fresh install the first-use step fetches the newest five by count and
// stores each one's track before any bulk download starts. The feed's head is
// the first five cards that carry a track, which reaches past the newest five
// whenever one of those five has no GPS. Only a head card outside the readied
// five still waits on the bulk GPS pass, so that share is what the head-first
// order of that pass can still move.
//
// It also counts the tracks the first bulk pass owes over the default window,
// which is how many downloads run beside the first-use step on a fresh install.
//
// Every position in the library is taken as the newest activity of a
// hypothetical first launch, so the figure covers the athlete's whole history
// rather than this week's mix.
//
// Usage: node scripts/measure-feed-head-gps.mjs <path to .env>
// The .env holds EXPO_PUBLIC_API_KEY and EXPO_PUBLIC_ATHLETE_ID. Prints counts
// and shares only, no ids.
import { readFileSync } from 'node:fs';

const [envPath] = process.argv.slice(2);
if (!envPath) {
  console.error('usage: measure-feed-head-gps.mjs <.env>');
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [
      line.slice(0, line.indexOf('=')).trim(),
      line.slice(line.indexOf('=') + 1).trim(),
    ])
);
const key = env.EXPO_PUBLIC_API_KEY;
const athlete = env.EXPO_PUBLIC_ATHLETE_ID;

// The counts the app uses, read from its source so the figure follows them.
const sync = readFileSync(
  new URL('../modules/veloqrs/rust/veloqrs/src/objects/sync.rs', import.meta.url),
  'utf8'
);
const readied = Number(sync.match(/const FIRST_USE_ACTIVITIES: u32 = (\d+);/)[1]);
const feedHead = readFileSync(
  new URL('../src/shared/activity/feedHead.ts', import.meta.url),
  'utf8'
);
const headCount = Number(feedHead.match(/const HEAD_COUNT = (\d+);/)[1]);
const windowDays = Number(
  readFileSync(
    new URL('../src/shared/native/activityWindow.generated.ts', import.meta.url),
    'utf8'
  ).match(/DEFAULT_ACTIVITY_DAYS = (\d+);/)[1]
);

const auth = 'Basic ' + Buffer.from(`API_KEY:${key}`).toString('base64');
const today = new Date().toISOString().slice(0, 10);
const url =
  `https://intervals.icu/api/v1/athlete/${athlete}/activities?` +
  new URLSearchParams({
    oldest: '2000-01-01',
    newest: today,
    fields: 'id,start_date_local,stream_types',
  });
const res = await fetch(url, { headers: { Authorization: auth, 'Accept-Encoding': 'gzip' } });
if (!res.ok) throw new Error(`census answered ${res.status}`);
const library = (await res.json())
  .filter((a) => a.start_date_local)
  .sort((a, b) => (a.start_date_local < b.start_date_local ? 1 : -1));
const hasTrack = library.map((a) => (a.stream_types ?? []).includes('latlng'));

// For a launch whose newest activity sits at `start`: the positions of the
// first `headCount` cards with a track, and how many fall past the readied five.
function headOutside(start) {
  const outside = [];
  let found = 0;
  for (let i = start; i < library.length && found < headCount; i++) {
    if (!hasTrack[i]) continue;
    outside.push(i - start >= readied);
    found++;
  }
  return outside;
}

const starts = library.length - readied;
let firstTwoInside = 0;
let allInside = 0;
let firstOutside = 0;
for (let start = 0; start < starts; start++) {
  const outside = headOutside(start);
  if (!outside.slice(0, 2).some(Boolean)) firstTwoInside++;
  if (!outside.some(Boolean)) allInside++;
  if (outside[0]) firstOutside++;
}
const pct = (n) => `${((100 * n) / starts).toFixed(1)}%`;
const now = headOutside(0);

console.log(
  `library ${library.length} activities, ${hasTrack.filter(Boolean).length} with a track`
);
console.log(
  `readied by the first-use step: newest ${readied}; feed head: first ${headCount} with a track`
);
console.log(
  `today: head cards past the readied five: ${now.filter(Boolean).length} of ${now.length}`
);
const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
const owed = library.filter(
  (a, i) => hasTrack[i] && a.start_date_local.slice(0, 10) >= windowStart
);
console.log(`tracks the first bulk pass owes over the default ${windowDays} days: ${owed.length}`);
console.log(`over ${starts} launch points:`);
console.log(`  first two previews both inside the readied five: ${pct(firstTwoInside)}`);
console.log(`  first preview outside the readied five:          ${pct(firstOutside)}`);
console.log(`  whole head inside the readied five:              ${pct(allInside)}`);
