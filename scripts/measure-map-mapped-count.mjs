#!/usr/bin/env node
// Measures why the map tab's "N activities · M on the map" line leaves
// activities off the map, against the real library.
//
// The engine counts every metrics row as the library and puts on the map only
// the activities with a stored track. So the gap is the activities the server
// lists with no `latlng` stream, plus any that list one the download cannot
// store: a series under two storable points, or one whose halves disagree in
// length. The first part comes from the activity list alone; the second needs
// each track fetched as the app fetches it.
//
// Usage: node scripts/measure-map-mapped-count.mjs <path to .env> <oldest YYYY-MM-DD>
// The .env holds EXPO_PUBLIC_API_KEY and EXPO_PUBLIC_ATHLETE_ID. The oldest
// date is the first day the library on the device holds. Prints counts by
// reason and sport, and the date and sport of any track that would not store.
import { readFileSync } from 'node:fs';

const [envPath, oldest] = process.argv.slice(2);
if (!envPath || !/^\d{4}-\d{2}-\d{2}$/.test(oldest ?? '')) {
  console.error('usage: measure-map-mapped-count.mjs <.env> <oldest YYYY-MM-DD>');
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
const auth = 'Basic ' + Buffer.from(`API_KEY:${env.EXPO_PUBLIC_API_KEY}`).toString('base64');
const base = 'https://intervals.icu/api/v1';

// One request at a time, waiting out a rate limit rather than failing on it.
async function get(path) {
  for (let wait = 2_000; ; wait *= 2) {
    const response = await fetch(base + path, { headers: { Authorization: auth } });
    if (response.status === 429 && wait <= 64_000) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
}

const newest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const activities = await get(
  `/athlete/${env.EXPO_PUBLIC_ATHLETE_ID}/activities?oldest=${oldest}&newest=${newest}` +
    '&fields=id,start_date_local,type,stream_types,trainer'
);

const tally = (rows) =>
  Object.entries(
    rows.reduce((counts, a) => ({ ...counts, [a.type]: (counts[a.type] ?? 0) + 1 }), {})
  )
    .sort((x, y) => y[1] - x[1])
    .map(([type, n]) => `${type} ${n}`)
    .join(', ');

const listed = activities.filter((a) => (a.stream_types ?? []).includes('latlng'));
const unlisted = activities.filter((a) => !(a.stream_types ?? []).includes('latlng'));

const storable = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

// The track as the download judges it: the paired points both halves carry,
// then the storable ones among them.
async function judge(activity) {
  const streams = await get(`/activity/${activity.id}/streams.json?types=latlng,time`);
  const latlng = streams.find((s) => s.type === 'latlng');
  if (!latlng) return 'no latlng in the stream response';
  const lats = latlng.data ?? [];
  const lngs = latlng.data2 ?? [];
  if (lats.length !== lngs.length) return 'latlng halves disagree in length';
  const points = lats.filter(
    (lat, i) => lat !== null && lngs[i] !== null && storable(lat, lngs[i])
  );
  if (points.length < 2) return `${points.length} storable points`;
  return null;
}

const refused = [];
for (const activity of listed) {
  const reason = await judge(activity);
  if (reason) refused.push({ activity, reason });
}

console.log(`window: ${oldest} to today, ${activities.length} activities`);
console.log(`listed with latlng: ${listed.length} (${tally(listed)})`);
console.log(`listed without latlng: ${unlisted.length} (${tally(unlisted)})`);
console.log(
  `  of those, marked trainer: ${unlisted.filter((a) => a.trainer).length}, ` +
    `no streams at all: ${unlisted.filter((a) => !(a.stream_types ?? []).length).length}`
);
console.log(`listed with latlng but not storable: ${refused.length}`);
for (const { activity, reason } of refused) {
  console.log(`  ${activity.start_date_local.slice(0, 10)} ${activity.type}: ${reason}`);
}
console.log(`expected on the map: ${listed.length - refused.length}`);
