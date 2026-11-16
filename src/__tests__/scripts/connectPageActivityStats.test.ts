/**
 * Scenario: the activity page groups its figures beside the map, reads the
 * averages of a brushed range, exports the track as GPX, and marks the ends of
 * the line and colours it by grade.
 *
 * Expected behaviour: a figure the activity does not carry is left out and a
 * group with no figure is not drawn; a range reads the mean of each series over
 * the samples it covers, ends included, and ignores gaps; the GPX holds one
 * track point per position in order with its elevation; the endpoints source
 * holds the first and last position; the grade line is the phone's own banding.
 */

import { rangeReadout, statGroups, gpxOf, type DetailData } from '../../../web/connect/activity';
import {
  activityMapSpec,
  endpointsData,
  gradeLine,
  numberSections,
  speedLine,
  splitOverlay,
  trackLine,
  zoneLine,
  type ActivityMapInput,
  type LngLat,
} from '../../../web/connect/map/activityLayers';
import { zoneColour } from '../../../web/connect/theme';
import type { ChartData } from '../../../web/connect/chart';
import type { FfiActivityRecord } from '../../../web/connect/schema';

const RECORD = {
  id: 'ride-3',
  name: 'Lake loop',
  sportType: 'Ride',
  startDateLocal: '2026-05-02T08:00:00',
  movingTime: 3_600,
  distance: 30_000,
  elevationGain: 420,
  avgHr: 141.4,
  maxHr: 178,
  avgPower: 212.6,
  maxPower: 640,
  calories: 880,
  trainingLoad: 74,
  weatherTemp: 17.5,
  windSpeed: null,
} as unknown as FfiActivityRecord;

const SUMMARY = {
  id: 'ride-3',
  movingTime: 3_600,
  elapsedTime: 3_800,
  averageSpeed: 8.3,
  maxSpeed: 13,
};

const DETAIL = {
  fitnessImpact: { fitness: 1.2, fatigue: 3.4, form: -2.2, fitnessDays: 42, fatigueDays: 7 },
  highlights: { newGround: [{ activityId: 'ride-3', fraction: 0.12, tiles: 96, newTiles: 11 }] },
} as unknown as DetailData;

describe('the figures beside the map', () => {
  it('groups what the activity carries, in the order time, speed, heart rate, power, load, energy, conditions, new ground', () => {
    const groups = statGroups({ record: RECORD, summary: SUMMARY, detail: DETAIL });
    expect(groups.map((group) => group.key)).toEqual([
      'time',
      'speed',
      'heartRate',
      'power',
      'load',
      'energy',
      'conditions',
      'newGround',
    ]);
    const rows = Object.fromEntries(
      groups.map((group) => [group.key, group.rows.map((row) => row.key)])
    );
    expect(rows['time']).toEqual(['distance', 'movingTime', 'elapsedTime', 'climbing']);
    expect(rows['speed']).toEqual(['averageSpeed', 'topSpeed']);
    expect(rows['heartRate']).toEqual(['averageHr', 'maxHr']);
    expect(rows['power']).toEqual(['averagePower', 'maxPower']);
    expect(rows['load']).toEqual(['trainingLoad', 'fitness', 'fatigue', 'form']);
    expect(rows['energy']).toEqual(['calories']);
    expect(rows['conditions']).toEqual(['temperature']);
    expect(rows['newGround']).toEqual(['newGround']);
  });

  it('writes the figures with their units, and the fitness impact signed', () => {
    const flat = Object.fromEntries(
      statGroups({ record: RECORD, summary: SUMMARY, detail: DETAIL }).flatMap((group) =>
        group.rows.map((row) => [row.key, row.value])
      )
    );
    expect(flat['distance']).toBe('30.0 km');
    expect(flat['averageHr']).toBe('141 bpm');
    expect(flat['maxPower']).toBe('640 W');
    expect(flat['calories']).toBe('880 kcal');
    expect(flat['temperature']).toBe('18 °C');
    expect(flat['form']).toBe('-2.2');
    expect(flat['fitness']).toBe('+1.2');
    expect(flat['newGround']).toBe('12 %');
  });

  it('leaves out the heart rate, power and conditions groups for an activity without them', () => {
    const bare = {
      ...RECORD,
      avgHr: null,
      maxHr: null,
      avgPower: null,
      maxPower: null,
      calories: null,
      trainingLoad: null,
      weatherTemp: null,
    } as unknown as FfiActivityRecord;
    const keys = statGroups({ record: bare, summary: SUMMARY, detail: undefined }).map(
      (group) => group.key
    );
    expect(keys).toEqual(['time', 'speed']);
  });

  it('draws nothing before the record has answered', () => {
    expect(statGroups({ record: undefined, summary: SUMMARY, detail: DETAIL })).toEqual([]);
  });
});

describe('the readout of a brushed range', () => {
  const data: ChartData = {
    time: [0, 10, 20, 30, 40, 50],
    distance: [0, 100, 250, 400, 600, 900],
    series: {
      heartrate: [100, 110, 120, 130, 140, 150],
      watts: [0, 200, NaN, 300, 400, 0],
    },
  };

  it('averages each series over the samples the range covers, ends included', () => {
    const readout = rangeReadout(data, { from: 1, to: 4 });
    expect(readout?.averages['heartrate']).toBe(125);
    expect(readout?.samples).toBe(4);
  });

  it('leaves a gap out of the mean rather than counting it as zero', () => {
    expect(rangeReadout(data, { from: 1, to: 4 })?.averages['watts']).toBe(300);
  });

  it('reports the time and the distance the range spans', () => {
    const readout = rangeReadout(data, { from: 1, to: 4 });
    expect(readout?.seconds).toBe(30);
    expect(readout?.metres).toBe(500);
  });

  it('clamps a range past the end and reads nothing for a series with no value in it', () => {
    const readout = rangeReadout(data, { from: 4, to: 99 });
    expect(readout?.samples).toBe(2);
    expect(
      rangeReadout(
        { ...data, series: { watts: [NaN, NaN, NaN, NaN, NaN, NaN] } },
        { from: 0, to: 5 }
      )?.averages
    ).toEqual({});
  });

  it('is null for no range and for a range that holds no sample', () => {
    expect(rangeReadout(data, null)).toBeNull();
    expect(rangeReadout(data, { from: 9, to: 12 })).toBeNull();
    expect(rangeReadout({ time: [], distance: [], series: {} }, { from: 0, to: 1 })).toBeNull();
  });
});

describe('the GPX export', () => {
  const positions: LngLat[] = [
    [7.3, 46.2],
    [7.31, 46.21],
    [7.32, 46.22],
  ];

  it('writes one track point per position in order, with elevation where there is one', () => {
    const gpx = gpxOf('Lake loop', positions, [400, NaN, 412.5]);
    expect(gpx.startsWith('<?xml')).toBe(true);
    expect(gpx).toContain('<name>Lake loop</name>');
    const points = [
      ...gpx.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)">(<ele>([\d.]+)<\/ele>)?/g),
    ];
    expect(points.map((p) => [p[1], p[2], p[4]])).toEqual([
      ['46.2', '7.3', '400'],
      ['46.21', '7.31', undefined],
      ['46.22', '7.32', '412.5'],
    ]);
  });

  it('escapes the name', () => {
    expect(gpxOf('Hill <&> back', positions)).toContain('<name>Hill &lt;&amp;&gt; back</name>');
  });
});

describe('the ends of the line and its colour', () => {
  const positions: LngLat[] = [
    [7.3, 46.2],
    [7.31, 46.21],
    [7.32, 46.22],
  ];

  it('marks the first and last position, start then end', () => {
    const collection = endpointsData(positions);
    expect(
      collection.features.map((f) => [
        f.properties?.['position'],
        (f.geometry as GeoJSON.Point).coordinates,
      ])
    ).toEqual([
      ['start', [7.3, 46.2]],
      ['end', [7.32, 46.22]],
    ]);
  });

  it('marks nothing on an empty track and one end on a single position', () => {
    expect(endpointsData([]).features).toEqual([]);
    expect(endpointsData([[7.3, 46.2]]).features).toHaveLength(1);
  });

  it('builds the phone grade banding over line-progress from the grade and distance streams', () => {
    const expression = gradeLine([0, 0, 8, 8, -8, -8], [0, 100, 200, 300, 400, 500], 'light');
    expect(expression?.[0]).toBe('step');
    expect(expression?.[1]).toEqual(['line-progress']);
  });

  it('gives no line without at least two grade samples', () => {
    expect(gradeLine([], [], 'light')).toBeNull();
    expect(gradeLine([3], [0], 'light')).toBeNull();
  });

  it('steps a power line once per zone band the ride crosses, in the zone colours', () => {
    const bands = [
      { zone: 1, upper: 100 },
      { zone: 2, upper: 200 },
      { zone: 3, upper: null },
    ];
    const watts = [50, 50, 150, 150, 300, 300];
    const distance = [0, 100, 200, 300, 400, 500];
    const expression = zoneLine(watts, distance, bands, 'light')!;
    expect(expression[0]).toBe('step');
    expect(expression[1]).toEqual(['line-progress']);
    const colours = expression.filter((_, at) => at === 2 || (at > 2 && at % 2 === 0));
    expect(colours).toEqual([zoneColour(1, false), zoneColour(2, false), zoneColour(3, false)]);
    const stops = expression.filter((_, at) => at > 2 && at % 2 === 1);
    expect(stops).toEqual([0.4, 0.8]);
  });

  it('uses the dark zone colours on a dark or satellite base', () => {
    const bands = [{ zone: 4, upper: null }];
    expect(zoneLine([1, 2], [0, 1], bands, 'satellite')![2]).toBe(zoneColour(4, true));
    expect(zoneLine([1, 2], [0, 1], bands, 'light')![2]).toBe(zoneColour(4, false));
  });

  it('gives no zone line without bands or without two samples', () => {
    expect(zoneLine([1, 2], [0, 1], [], 'light')).toBeNull();
    expect(zoneLine([1], [0], [{ zone: 1, upper: null }], 'light')).toBeNull();
  });

  it('bands speed against its own mean, faster on the cool side', () => {
    const expression = speedLine([5, 5, 10, 10, 15, 15], [0, 1, 2, 3, 4, 5], 'light')!;
    const colours = expression.filter((_, at) => at === 2 || (at > 2 && at % 2 === 0));
    expect(colours).toHaveLength(3);
    expect(new Set(colours).size).toBe(3);
    expect(speedLine([3, 3], [0, 1], 'light')).not.toBeNull();
    expect(speedLine([0, 0, 0], [0, 1, 2], 'light')).toBeNull();
  });

  it('chooses the banding by the stream the line is coloured by', () => {
    const distance = [0, 1, 2, 3];
    const grade = trackLine({ stream: 'grade', values: [0, 9, 9, -9], distance }, 'light');
    expect(grade).toEqual(gradeLine([0, 9, 9, -9], distance, 'light'));
    const power = trackLine(
      {
        stream: 'power',
        values: [50, 250],
        distance: [0, 1],
        zones: [
          { zone: 1, upper: 100 },
          { zone: 2, upper: null },
        ],
      },
      'light'
    );
    expect(power).toEqual(
      zoneLine(
        [50, 250],
        [0, 1],
        [
          { zone: 1, upper: 100 },
          { zone: 2, upper: null },
        ],
        'light'
      )
    );
    expect(
      trackLine({ stream: 'heartrate', values: [1, 2], distance: [0, 1] }, 'light')
    ).toBeNull();
  });

  it('numbers the sections by the order the track meets them, a repeat keeping its number', () => {
    expect(numberSections(['col', 'ford', 'col', 'bridge'])).toEqual(
      new Map([
        ['col', 1],
        ['ford', 2],
        ['bridge', 3],
      ])
    );
  });

  it('writes the number on each section feature and draws it with a label layer', () => {
    const overlay = splitOverlay(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'section', id: 'col' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { kind: 'section', id: 'ford' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [1, 1],
                [2, 2],
              ],
            },
          },
        ],
      })
    );
    expect(overlay.sections.features.map((f) => f.properties?.['number'])).toEqual(['1', '2']);
    const spec = activityMapSpec({
      base: 'light',
      activityId: 'ride-3',
      revision: 1,
      overlay,
      crosshair: null,
      highlightedSectionId: null,
      compare: [],
    });
    const label = spec.layers.find((l) => l.id === 'section-number');
    expect(label?.type).toBe('symbol');
    expect(JSON.stringify(label)).toContain('"text-field":["get","number"]');
    expect(JSON.stringify(label)).toContain('"text-font"');
  });

  it('draws the gradient layer only when a line was given, and the solid line otherwise', () => {
    const input: ActivityMapInput = {
      base: 'light',
      activityId: 'ride-3',
      revision: 1,
      overlay: { sections: empty(), portions: empty(), markers: empty() },
      crosshair: null,
      highlightedSectionId: null,
      compare: [],
    };
    const layer = (spec: ReturnType<typeof activityMapSpec>) =>
      spec.layers.find((l) => l.id === 'route-gradient-line');
    expect(JSON.stringify(layer(activityMapSpec(input)))).toContain('"line-opacity":0');
    const coloured = activityMapSpec({
      ...input,
      gradient: ['step', ['line-progress'], '#000', 1, '#111'],
    });
    expect(JSON.stringify(layer(coloured))).toContain('"line-gradient"');
  });

  it('holds the endpoints in the source the phone layers read', () => {
    const input: ActivityMapInput = {
      base: 'light',
      activityId: 'ride-3',
      revision: 1,
      overlay: { sections: empty(), portions: empty(), markers: empty() },
      crosshair: null,
      highlightedSectionId: null,
      compare: [],
      endpoints: endpointsData(positions),
    };
    const source = activityMapSpec(input).sources['endpoints'];
    expect(JSON.stringify(source)).toContain('"position":"start"');
  });
});

function empty(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
