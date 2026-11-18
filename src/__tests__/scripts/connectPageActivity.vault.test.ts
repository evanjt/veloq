/**
 * Scenario: the activity page draws a ride from the phone's detail reads.
 *
 * Expected behaviour: the engine's 64-bit float buffers decode to the chart's
 * series on the time axis; a series of another length than the time axis is
 * dropped; an activity with no time axis has no chart; laps and sections
 * become the right column's rows without repeating a section.
 */

import {
  chartDataOf,
  doublesOf,
  factsOfDetail,
  portionHolds,
  type DetailData,
  type Laps,
  type Streams,
} from '../../../web/connect/activity';

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
          {
            kind: 'work',
            movingTime: 300,
            distance: 2760,
            label: 'Lantern climb',
            startIndex: 0,
            endIndex: 99,
          },
          {
            kind: 'recovery',
            movingTime: 120,
            distance: null,
            label: null,
            startIndex: 100,
            endIndex: 150,
          },
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
      {
        name: 'Lantern climb',
        time: '5 min',
        distance: expect.stringContaining('2'),
        portion: { from: 0, to: 99 },
      },
      { name: 'Recovery', time: '2 min', distance: '', portion: { from: 100, to: 150 } },
    ]);
    expect(facts.sections?.map((row) => row.id)).toEqual(['s1', 'c1']);
    expect(facts.sections?.[1]?.name).toBe('c1');
    expect(factsOfDetail(undefined, undefined)).toEqual({
      sections: [],
      passes: [],
      standing: [],
      memberships: [],
      routes: [],
      intervals: [],
      zones: [],
      notes: [],
    });
  });

  it('places each interval in the zone band its mean power falls in, or its mean heart rate without power', () => {
    const interval = (averageWatts: number | null, averageHeartrate: number | null) =>
      ({
        kind: 'work',
        movingTime: 60,
        distance: 300,
        label: null,
        averageWatts,
        averageHeartrate,
        startIndex: 0,
        endIndex: 1,
      }) as const;
    const laps = {
      intervals: {
        intervals: [
          interval(220, 120),
          interval(200, null),
          interval(null, 165),
          interval(null, 185),
          interval(400, null),
          interval(null, null),
        ],
      },
    } as unknown as Laps;
    const detail = {
      hrZones: [
        { zone: 1, minBpm: 0, maxBpm: 120, share: 0.1 },
        { zone: 2, minBpm: 120, maxBpm: 150, share: 0.2 },
        { zone: 3, minBpm: 150, maxBpm: 170, share: 0.3 },
      ],
      powerZones: [
        { zone: 1, minWatts: 0, maxWatts: 150, share: 0.1 },
        { zone: 2, minWatts: 150, maxWatts: 200, share: 0.2 },
        { zone: 3, minWatts: 200, maxWatts: 250, share: 0.3 },
        { zone: 4, minWatts: 250, maxWatts: null, share: 0.4 },
      ],
    } as unknown as DetailData;
    expect(factsOfDetail(laps, detail).intervals?.map((row) => row.band)).toEqual([
      3,
      3,
      3,
      3,
      4,
      undefined,
    ]);
    expect(
      factsOfDetail(laps, { hrZones: detail.hrZones } as unknown as DetailData).intervals?.[0]?.band
    ).toBe(2);
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

  it('lists the passes in track order with lap time, place, record flag and history, and the standing on each route', () => {
    const pass = (sectionId: string, startIndex: number, lapTime: number, rank: number | null) => ({
      sectionId,
      sectionName: sectionId.toUpperCase(),
      direction: 'forward',
      startIndex,
      lapTime,
      rank,
      isPr: rank === 1,
      historyTimes: [lapTime + 20, lapTime],
      historyActivityIds: ['other', 'a1'],
    });
    const detail = {
      encounters: [pass('ford', 300, 50, null), pass('col', 40, 250, 1)],
      routeGroups: [
        {
          groupId: 'g1',
          customName: 'Lake loop',
          activityIds: ['a1', 'a2'],
          bestTime: 3500,
          avgTime: 3700,
          bestActivityId: 'a2',
        },
      ],
    } as unknown as DetailData;
    const facts = factsOfDetail(undefined, detail, 'a1', 3560);
    expect(
      facts.passes?.map((row) => [row.id, row.lapTime, row.rank, row.pr, row.current])
    ).toEqual([
      ['col', '4:10', 1, true, 1],
      ['ford', '0:50', null, false, 1],
    ]);
    expect(facts.standing).toEqual([
      expect.objectContaining({ id: 'g1', best: '58:20', average: '1:01:40', gap: '+1:00' }),
    ]);
  });

  it('passes each route and section the activity matched through, with whether it is left out of that one', () => {
    const detail = {
      memberships: [
        { kind: 'route', id: 'loop', name: 'Lake loop', excluded: false },
        { kind: 'section', id: 'hill', name: null, excluded: true },
      ],
    } as unknown as DetailData;
    expect(factsOfDetail(undefined, detail, 'a1').memberships).toEqual([
      { kind: 'route', id: 'loop', name: 'Lake loop', excluded: false },
      { kind: 'section', id: 'hill', name: 'hill', excluded: true },
    ]);
  });

  it('lights a section while the crosshair is inside its portion', () => {
    const portion = { from: 10, to: 20 };
    expect(portionHolds(portion, 10)).toBe(true);
    expect(portionHolds(portion, 20)).toBe(true);
    expect(portionHolds(portion, 21)).toBe(false);
    expect(portionHolds(portion, null)).toBe(false);
    expect(portionHolds(undefined, 12)).toBe(false);
  });
});
