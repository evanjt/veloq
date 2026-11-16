/**
 * Scenario: the map page paints its markers by sport or by age, dims every mark but the lit one
 * while a row or a line is under the pointer, and draws the focused activity's track from a
 * source that stays mounted when nothing is focused.
 *
 * Expected behaviour: a start point carries its sport's colour and its age; hovering turns the
 * unlit marks and lines faint and leaves the lit one at full strength; the track source is always
 * in the spec, empty with no focus and the activity's own address with one.
 */

import { mapSpec, sportColour, startPoints } from '../../../web/connect/map/MapScreen';

const METHODS = ['heatmap.tile', 'geo.sections', 'geo.routeLines', 'geo.track'];
const input = { methods: METHODS, layers: ['starts'] as const, heatmapVersion: 0 };
const base = { ...input, routesVersion: 1, sectionsVersion: 1, starts: { features: [] } };

const layer = (spec: ReturnType<typeof mapSpec>, id: string) =>
  spec.layers.find((each) => each.id === id);

const activity = (id: string, sportType: string, date: number) =>
  ({
    activityId: id,
    sportType,
    isVirtual: false,
    bounds: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
    startLat: 0.5,
    startLng: 0.5,
    date,
    name: id,
    distance: 1000,
    duration: 60,
  }) as Parameters<typeof startPoints>[0][number];

describe('the start points', () => {
  const NOW = 1_800_000_000;
  const YEAR = 365 * 86_400;

  it('carry the sport colour of their family and an age from now to a year back', () => {
    const points = startPoints(
      [activity('ride', 'Ride', NOW), activity('run', 'Run', NOW - YEAR / 2)],
      'light',
      NOW
    );
    const [ride, run] = points.features;
    expect(ride?.properties).toMatchObject({
      id: 'ride',
      colour: sportColour('Ride', 'light'),
      age: 0,
    });
    expect(run?.properties.age).toBeCloseTo(0.5);
    expect(sportColour('Ride', 'light')).not.toBe(sportColour('Run', 'light'));
  });

  it('leave out an activity that has no start', () => {
    const bare = { ...activity('x', 'Ride', NOW), startLat: null, startLng: null };
    expect(startPoints([bare], 'dark', NOW).features).toEqual([]);
  });

  it('take another colour on the dark base', () => {
    expect(sportColour('Run', 'dark')).not.toBe(sportColour('Run', 'light'));
  });
});

describe('the spec while a mark is under the pointer', () => {
  const opacity = (dim: boolean) =>
    layer(mapSpec('light', { ...base, dim }), 'starts')?.paint?.['circle-opacity'] as unknown[];

  it('draws the unlit marks faint and the lit one at full strength', () => {
    expect(opacity(true)?.slice(-2)).toEqual([1, 0.25]);
  });

  it('draws every mark at full strength with nothing under the pointer', () => {
    expect(opacity(false)?.slice(-2)).toEqual([1, 1]);
    const routes = layer(mapSpec('light', { ...base, dim: true }), 'routes')?.paint?.[
      'line-opacity'
    ] as unknown[];
    expect(routes.slice(-2)).toEqual([1, 0.25]);
  });
});

describe('the colouring', () => {
  const colour = (colouring: 'sport' | 'recency') =>
    layer(mapSpec('light', { ...base, colouring }), 'starts')?.paint?.['circle-color'];

  it('reads the sport colour from the point, or interpolates its age', () => {
    expect(colour('sport')).toEqual(['get', 'colour']);
    expect((colour('recency') as unknown[])[0]).toBe('interpolate');
  });
});

describe('the focused track', () => {
  it('is mounted empty with no focus, so the source is never taken down', () => {
    const spec = mapSpec('light', { ...base, track: null });
    expect(spec.sources.track).toMatchObject({
      kind: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    expect(layer(spec, 'track')).toBeDefined();
  });

  it('reads the activity own line once one is focused, and escapes its id', () => {
    const spec = mapSpec('light', { ...base, track: 'a/1' });
    expect(spec.sources.track).toMatchObject({ data: 'veloq://geo/track/a%2F1' });
  });

  it('is absent when the phone lists no track read', () => {
    const spec = mapSpec('light', { ...base, methods: ['heatmap.tile'], track: 'a1' });
    expect(spec.sources.track).toBeUndefined();
  });
});
