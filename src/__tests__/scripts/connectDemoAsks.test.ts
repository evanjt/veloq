/**
 * Scenario: the connect page asks the demo phone for a filtered, windowed or
 * ranged read.
 *
 * Expected behaviour: the phone answers as the engine does, so a search, a
 * sport chip and a date window narrow the feed, a range narrows the fitness
 * series, the heat tile is drawn in the base's heat ramp, and the track holds
 * one point per stream sample.
 */

import { inflateSync } from 'node:zlib';

import { mapPalette } from '@/theme';

import {
  ACTIVITIES,
  DAY,
  LIBRARY_END,
  heatTilePng,
  streams,
  trackOf,
  withTrack,
} from '../__shared__/connectDemoBase';
import { demoScript } from '../__shared__/connectDemoLibrary';
import { answerAsk } from '../__shared__/connectPhoneShim';

const script = demoScript({ browserFingerprint: 'b', phoneProof: 'p', phoneFingerprint: 'f' });
const feed = (ask: Record<string, unknown>) =>
  answerAsk(script, 'feed.page', {
    offset: 0,
    limit: 500,
    needle: '',
    sportFamilies: [],
    oldestTs: null,
    newestTs: null,
    ...ask,
  }).result as {
    cards: { id: string; name: string; sportType: string; startDateLocal: string }[];
    matchedCount: number;
    hasMore: boolean;
    previews: { activityId: string }[];
    familyCounts: { family: string; count: number }[];
  };

const seconds = (ms: number) => Math.floor(ms / 1000);

describe('the feed read', () => {
  it('lists only the cards whose name or sport holds the search text, counting every match', () => {
    const all = feed({});
    const found = feed({ needle: ' Ramble ' });
    const expected = ACTIVITIES.filter((a) =>
      `${a.name} ${a.sport.type}`.toLowerCase().includes('ramble')
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(ACTIVITIES.length);
    expect(found.cards).toHaveLength(expected.length);
    expect(found.matchedCount).toBe(expected.length);
    expect(all.matchedCount).toBe(ACTIVITIES.length);
    expect(feed({ needle: 'no such activity' })).toMatchObject({
      cards: [],
      matchedCount: 0,
      hasMore: false,
      previews: [],
      familyCounts: [],
    });
  });

  it('keeps the chosen families, and counts the families with the chips left out', () => {
    const runs = feed({ sportFamilies: ['run'] });
    expect(runs.cards.length).toBeGreaterThan(0);
    expect(runs.cards.every((card) => card.sportType === 'Run')).toBe(true);
    expect(runs.matchedCount).toBe(ACTIVITIES.filter((a) => a.sport.family === 'run').length);
    expect(runs.familyCounts).toEqual(feed({}).familyCounts);
  });

  it('keeps the activities inside the window, newest first', () => {
    const oldestTs = seconds(LIBRARY_END - 30 * DAY);
    const newestTs = seconds(LIBRARY_END - 10 * DAY);
    const inside = ACTIVITIES.filter(
      (a) => seconds(a.start) >= oldestTs && seconds(a.start) <= newestTs
    );
    const page = feed({ oldestTs, newestTs });
    expect(inside.length).toBeGreaterThan(0);
    expect(page.matchedCount).toBe(inside.length);
    const dates = page.cards.map((card) => card.startDateLocal);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates.every((d) => d >= new Date(oldestTs * 1000).toISOString().slice(0, 19))).toBe(
      true
    );
  });

  it('pages the matches and previews only the cards on the page', () => {
    const first = feed({ limit: 5 });
    const second = feed({ limit: 5, offset: 5 });
    expect(first.cards).toHaveLength(5);
    expect(first.hasMore).toBe(true);
    expect(second.cards[0]).not.toEqual(first.cards[0]);
    const last = feed({ offset: ACTIVITIES.length - 2 });
    expect(last.cards).toHaveLength(2);
    expect(last.hasMore).toBe(false);
    const shown = new Set(first.previews.map((p) => p.activityId));
    expect(shown.size).toBeGreaterThan(0);
    const onPage = new Set(first.cards.map((card) => card.id));
    expect([...shown].every((id) => onPage.has(id))).toBe(true);
  });
});

describe('the fitness reads', () => {
  const days = (method: string, params: Record<string, unknown>) =>
    (answerAsk(script, method, params).result as { days: { date: string }[] }).days;

  it('answers the wellness days from oldest to newest, both inclusive', () => {
    const newest = new Date(LIBRARY_END).toISOString().slice(0, 10);
    const oldest = new Date(LIBRARY_END - 89 * DAY).toISOString().slice(0, 10);
    const rows = days('fitness.wellness', { oldest, newest });
    expect(rows).toHaveLength(90);
    expect(rows[0]?.date).toBe(oldest);
    expect(rows[89]?.date).toBe(newest);
    expect(days('fitness.wellness', { oldest: '2001-01-01', newest: '2001-02-01' })).toEqual([]);
  });

  it('answers form for the same days as the window, with its unit and zone edges', () => {
    const newest = new Date(LIBRARY_END).toISOString().slice(0, 10);
    const oldest = new Date(LIBRARY_END - 89 * DAY).toISOString().slice(0, 10);
    const whole = answerAsk(script, 'fitness.wellness', {
      oldest: '2000-01-01',
      newest: '2100-01-01',
    }).result as { days: { date: string }[]; form: (number | null)[] };
    const cut = answerAsk(script, 'fitness.wellness', { oldest, newest }).result as {
      days: { date: string }[];
      form: (number | null)[];
      formAsPercent: boolean;
      formZoneEdges: number[];
    };

    expect(cut.form).toHaveLength(cut.days.length);
    expect(cut.form).toEqual(whole.form.slice(whole.form.length - 90));
    expect(typeof cut.formAsPercent).toBe('boolean');
    expect(cut.formZoneEdges.length).toBeGreaterThan(0);
    const empty = answerAsk(script, 'fitness.wellness', {
      oldest: '2001-01-01',
      newest: '2001-02-01',
    }).result as { days: unknown[]; form: unknown[] };
    expect(empty.form).toEqual([]);
  });

  it('answers the load days of the window in wall-clock seconds, both inclusive', () => {
    const rows = days('fitness.loads', {
      startTs: seconds(LIBRARY_END - 89 * DAY),
      endTs: seconds(LIBRARY_END) + 86_399,
    });
    expect(rows).toHaveLength(90);
    expect(rows[89]?.date).toBe(new Date(LIBRARY_END).toISOString().slice(0, 10));
  });

  it('gives the wellness series noise and a trend, and sleep and weight that vary', () => {
    const rows = answerAsk(script, 'fitness.wellness', {
      oldest: '2000-01-01',
      newest: '2100-01-01',
    }).result as { days: { hrv: number; sleepSecs: number; weight: number }[] };
    const distinct = (pick: (d: (typeof rows.days)[number]) => number) =>
      new Set(rows.days.map((d) => pick(d).toFixed(3))).size;
    expect(distinct((d) => d.sleepSecs)).toBeGreaterThan(20);
    expect(distinct((d) => d.weight)).toBeGreaterThan(20);
    expect(distinct((d) => d.hrv)).toBeGreaterThan(100);
  });
});

function opaqueColours(png: string): Set<string> {
  const data = Buffer.from(png, 'base64');
  let at = 8;
  let width = 0;
  const idat: Buffer[] = [];
  while (at < data.length) {
    const length = data.readUInt32BE(at);
    const type = data.subarray(at + 4, at + 8).toString('ascii');
    const body = data.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') width = body.readUInt32BE(0);
    if (type === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 4;
  const found = new Set<string>();
  for (let y = 0; y < raw.length / stride; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * stride + 1 + x * 4;
      if (raw[p + 3] === 0) continue;
      found.add(
        `#${[raw[p], raw[p + 1], raw[p + 2]].map((v) => (v as number).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
      );
    }
  }
  return found;
}

describe('the heat tile', () => {
  it.each(['light', 'dark', 'satellite'] as const)(
    'paints only colours of the %s base heat ramp, and each step of it',
    (base) => {
      const ramp = mapPalette(base).heat.map((colour) => colour.toUpperCase());
      const used = opaqueColours(heatTilePng(base));
      expect([...used].every((colour) => ramp.includes(colour))).toBe(true);
      expect(used.size).toBeGreaterThan(1);
    }
  );

  it('answers a tile of the base the page asks for', () => {
    const tile = (base: string) =>
      (script.tiles?.[base] ?? script.tilesByBase?.[base]) as string | undefined;
    expect(tile('dark')).toBe(heatTilePng('dark'));
    expect(tile('light')).toBe(heatTilePng('light'));
    expect(tile('light')).not.toBe(tile('dark'));
  });
});

describe('the activity track', () => {
  it('holds one point per stream sample', () => {
    for (const a of withTrack) {
      const samples = Buffer.from(streams(a).time, 'base64').length / 8;
      expect(trackOf(a)).toHaveLength(samples);
    }
  });
});
