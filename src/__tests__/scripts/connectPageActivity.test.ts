/**
 * Scenario: the activity page draws a ride from the phone's detail reads.
 *
 * Expected behaviour: the engine's 64-bit float buffers decode to the chart's
 * series on the time axis; a series of another length than the time axis is
 * dropped; an activity with no time axis has no chart; laps and sections
 * become the right column's rows without repeating a section; opening a second
 * ride withdraws the first ride's outstanding series.
 */

import {
  DETAIL_SLOTS,
  chartDataOf,
  doublesOf,
  factsOfDetail,
  portionHolds,
  type DetailData,
  type Laps,
  type Streams,
} from '../../../web/connect/activity';
import { createClient, type Channel } from '../../../web/connect/client';
import { isSuperseded } from '../../../web/connect/link';

const encode = (values: number[]) => {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, at) => view.setFloat64(at * 8, value, true));
  return Buffer.from(bytes).toString('base64');
};

const streams = (parts: Partial<Streams>): Streams => ({
  latlng: '',
  time: '',
  altitude: '',
  heartrate: '',
  watts: '',
  cadence: '',
  velocitySmooth: '',
  distance: '',
  gradeSmooth: '',
  temp: '',
  wbal: '',
  gap: '',
  ...parts,
});

describe('the activity page data', () => {
  it('reads little-endian doubles, with a gap as NaN', () => {
    const read = doublesOf(encode([1.5, NaN, -3]));
    expect(read.length).toBe(3);
    expect(read[0]).toBe(1.5);
    expect(read[1]).toBeNaN();
    expect(read[2]).toBe(-3);
    expect(doublesOf('').length).toBe(0);
  });

  it('names each series on the time axis and drops one of another length', () => {
    const data = chartDataOf(
      streams({
        time: encode([0, 1, 2]),
        distance: encode([0, 5, 10]),
        watts: encode([100, 150, 200]),
        velocitySmooth: encode([4, 5, 6]),
        heartrate: encode([120, 130]),
      })
    );
    expect(data?.time).toEqual([0, 1, 2]);
    expect(Object.keys(data?.series ?? {}).sort()).toEqual(['velocity', 'watts']);
  });

  it('draws no chart for an activity with no time axis', () => {
    expect(chartDataOf(streams({ watts: encode([1, 2]) }))).toBeNull();
    expect(chartDataOf(undefined)).toBeNull();
  });

  it('turns laps and sections into rows, once per section', () => {
    const laps = {
      intervals: {
        intervals: [
          { kind: 'work', movingTime: 300, distance: 2760, label: 'Lantern climb' },
          { kind: 'recovery', movingTime: 120, distance: null, label: null },
        ],
      },
    } as unknown as Laps;
    const detail = {
      matchedSections: [{ id: 's1', name: 'Col', distanceMeters: 1200 }],
      customSections: [
        { id: 's1', name: 'Col', distanceMeters: 1200 },
        { id: 'c1', name: null, distanceMeters: 400 },
      ],
    } as unknown as DetailData;
    const facts = factsOfDetail(laps, detail);
    expect(facts.intervals).toEqual([
      { name: 'Lantern climb', time: '5 min', distance: expect.stringContaining('2') },
      { name: 'Recovery', time: '2 min', distance: '' },
    ]);
    expect(facts.sections?.map((row) => row.id)).toEqual(['s1', 'c1']);
    expect(facts.sections?.[1]?.name).toBe('c1');
    expect(factsOfDetail(undefined, undefined)).toEqual({
      sections: [],
      routes: [],
      intervals: [],
      zones: [],
      notes: [],
    });
  });

  it('fills the right column from the whole detail read', () => {
    const detail = {
      matchedSections: [{ id: 's1', name: 'Col', distanceMeters: 1200 }],
      customSections: [
        {
          id: 'c1',
          name: 'Ford',
          distanceMeters: 400,
          activityPortions: [
            { activityId: 'other', startIndex: 1, endIndex: 2 },
            { activityId: 'a1', startIndex: 10, endIndex: 20 },
          ],
        },
      ],
      routeGroups: [
        { groupId: 'g1', customName: 'Lake loop', activityIds: ['a1', 'a2'], bestTime: 100 },
        { groupId: 'g2', customName: null, activityIds: ['a1'], bestTime: null },
      ],
      hrZones: [{ zone: 2, minBpm: 110, maxBpm: 130, share: 0.25 }],
      powerZones: [{ zone: 3, minWatts: 150, maxWatts: null, share: 0.5 }],
      fitnessImpact: { fitness: 1.26, fatigue: 4.5, form: -3.2 },
      provenance: 'garminOnPhone',
      ledgerChanges: [{ eventId: 1, sectionId: 's1', sectionName: 'Col', kind: 'moved' }],
    } as unknown as DetailData;
    const facts = factsOfDetail(undefined, detail, 'a1');
    expect(facts.routes).toEqual([
      { id: 'g1', name: 'Lake loop', detail: '2 rides' },
      { id: 'g2', name: 'g2', detail: '1 ride' },
    ]);
    expect(facts.sections?.map((row) => row.portion)).toEqual([undefined, { from: 10, to: 20 }]);
    expect(facts.zones?.map((zone) => zone.rows)).toEqual([
      [{ name: 'Z2 110–130 bpm', share: 0.25 }],
      [{ name: 'Z3 150+ W', share: 0.5 }],
    ]);
    const notes = Object.fromEntries((facts.notes ?? []).map((note) => [note.label, note.value]));
    expect(notes['Fitness impact']).toBe('+1.3 fitness, +4.5 fatigue, -3.2 form');
    expect(notes['Source']).toBe('Recorded on the phone from Garmin');
    expect(notes['Section changes']).toBe('1');
  });

  it('lights a section while the crosshair is inside its portion', () => {
    const portion = { from: 10, to: 20 };
    expect(portionHolds(portion, 10)).toBe(true);
    expect(portionHolds(portion, 20)).toBe(true);
    expect(portionHolds(portion, 21)).toBe(false);
    expect(portionHolds(portion, null)).toBe(false);
    expect(portionHolds(undefined, 12)).toBe(false);
  });

  it('withdraws the first ride’s series when a second ride is opened', async () => {
    const sent: { id?: number; method: string; params: { id?: number | string } }[] = [];
    const channel: Channel = {
      readyState: 'open',
      binaryType: 'blob',
      send: (text) => sent.push(JSON.parse(text)),
      onmessage: null,
    };
    const client = createClient(channel);
    const types = ['time'];
    const first = client
      .ask('activity.streams', { id: 'a1', types }, DETAIL_SLOTS.streams)
      .catch((error: unknown) => error);
    const laps = client.ask('activity.intervals', { id: 'a1' }, DETAIL_SLOTS.laps);
    void client.ask('activity.streams', { id: 'a2', types }, DETAIL_SLOTS.streams);
    expect(sent.map((message) => message.method)).toEqual([
      'activity.streams',
      'activity.intervals',
      'cancel',
      'activity.streams',
    ]);
    expect(sent[2]?.params.id).toBe(1);
    expect(isSuperseded(await first)).toBe(true);
    void laps.catch(() => undefined);
  });
});
