/**
 * Scenario: the activity page opens a ride with a track, a recorded set of
 * streams and the engine's detail, and an activity with no GPS.
 *
 * Expected behaviour: the shared detail header names the date and time, the
 * sport and where the data came from, and carries the export, the heatmap
 * switch and the link to intervals.icu; hovering a chart places the map's marker
 * at the same sample and hovering the track moves the chart's crosshair; a brush
 * on the charts is passed to the map and read out as averages; the stream chips
 * choose the lanes; the track is coloured by grade when asked; an activity with
 * no GPS shows an empty state in the map's place.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ActivityPage, type Position } from '../../../web/connect/pages/ActivityPage';
import type { DetailData } from '../../../web/connect/activity';
import type { ChartData } from '../../../web/connect/chart';
import type { FfiActivityRecord } from '../../../web/connect/schema';
import { km, paceText } from '../../../web/connect/format';
import { fakePhone } from '../__shared__/connectPhone';

type MapProps = {
  position: Position | null;
  onPosition: (position: Position | null) => void;
  range?: { from: number; to: number } | null;
  colour?: {
    stream: string;
    values: readonly number[];
    distance: readonly number[];
    zones?: readonly { zone: number; upper: number | null }[];
  } | null;
};

let mapProps: MapProps | null = null;

jest.mock('../../../web/connect/map/ActivityMap', () => ({
  ActivityMap: (props: MapProps) => {
    mapProps = props;
    return null;
  },
}));

const RECORD = {
  id: 'ride-3',
  name: 'Lake loop',
  sportType: 'Ride',
  startDateLocal: '2026-05-02T08:15:00',
  movingTime: 3_600,
  distance: 24_900,
  elevationGain: 420,
  avgHr: 141,
  avgPower: 212,
} as unknown as FfiActivityRecord;

const DETAIL = {
  hasGpsTrack: true,
  intervalsId: 'i4242',
  provenance: 'intervals',
  heatmapHidden: false,
} as unknown as DetailData;

const SAMPLES = 600;
const wave = (base: number, amplitude: number) =>
  Array.from({ length: SAMPLES }, (_, i) => base + amplitude * Math.sin(i / 25));

const DATA: ChartData = {
  time: Array.from({ length: SAMPLES }, (_, i) => i * 6),
  distance: Array.from({ length: SAMPLES }, (_, i) => i * 41.5),
  series: {
    altitude: wave(420, 60),
    heartrate: wave(140, 20),
    watts: wave(210, 90),
    grade: wave(0, 5),
  },
};

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const phone = fakePhone(() => ({ text: '', heatmapHidden: false, ok: true }));

async function mount(props: Partial<React.ComponentProps<typeof ActivityPage>> = {}) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  mapProps = null;
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      phone.wrap(
        <ActivityPage
          id="ride-3"
          record={RECORD}
          detail={undefined}
          detailData={DETAIL}
          data={DATA}
          queries={phone.queries}
          {...props}
        />
      ),
      {
        createNodeMock: () => ({
          getBoundingClientRect: () => ({ width: 640, left: 0 }),
        }),
      }
    );
  });
  return root;
}

const hosts = (root: ReactTestRenderer | ReactTestInstance, type: string) =>
  ('root' in root ? root.root : root).findAll((node) => node.type === type);
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
const byId = (root: ReactTestRenderer, id: string) => root.root.findAllByProps({ id });

const lanesOf = (root: ReactTestRenderer) =>
  hosts(root, 'g')
    .filter((g) => g.props['data-lane'])
    .map((g) => g.props['data-lane']);

const chartSvg = (root: ReactTestRenderer) =>
  hosts(root, 'svg').find((svg) => svg.props.role === 'group' && svg.props['aria-label'])!;

/** The pixel at `fraction` of the way across the plot the lanes draw in. */
function pixelAt(root: ReactTestRenderer, fraction: number) {
  const rect = hosts(chartSvg(root), 'rect')[0]!;
  const left = Number(rect.props.x);
  return left + fraction * Number(rect.props.width);
}

const pointer = (clientX: number) => ({
  clientX,
  button: 0,
  pointerId: 1,
  currentTarget: {
    getBoundingClientRect: () => ({ left: 0 }),
    setPointerCapture: () => undefined,
  },
});

describe('the shared detail header', () => {
  it('names the date and time, the sport and where the data came from', async () => {
    const root = await mount();
    const header = byId(root, 'activity-header')[0]!;
    expect(textOf(byId(root, 'activity-when')[0]!)).toBe('2026-05-02 08:15 · Ride');
    expect(textOf(header)).toContain('connectPage.activity.provenance.intervals');
    expect(hosts(header, 'svg').some((svg) => svg.props['data-sport'] === 'ride')).toBe(true);
  });

  it('carries the export, the heatmap switch and the link to intervals.icu as its actions', async () => {
    const root = await mount();
    const header = byId(root, 'activity-header')[0]!;
    const labels = hosts(header, 'button').map(textOf);
    expect(labels).toContain('connectPage.activity.exportGpx');
    const link = hosts(header, 'a').find(
      (a) => textOf(a) === 'connectPage.activity.openOnIntervals'
    );
    expect(link?.props.href).toBe('https://intervals.icu/activities/i4242');
    expect(link?.props.target).toBe('_blank');
    expect(link?.props.rel).toContain('noopener');
  });

  it('offers no link to intervals.icu for an activity it holds no id there for, and no export without a track', async () => {
    const root = await mount({
      detailData: {
        ...DETAIL,
        intervalsId: null,
        hasGpsTrack: false,
      } as DetailData,
    });
    const header = byId(root, 'activity-header')[0]!;
    expect(hosts(header, 'a').map(textOf)).not.toContain('connectPage.activity.openOnIntervals');
    expect(hosts(header, 'button').map(textOf)).not.toContain('connectPage.activity.exportGpx');
  });
});

describe('the map and the charts', () => {
  it('places the marker at the sample under the chart pointer, and clears it when the pointer leaves', async () => {
    const root = await mount();
    expect(mapProps?.position).toBeNull();
    await act(async () => chartSvg(root).props.onPointerMove(pointer(pixelAt(root, 0.5))));
    const index = mapProps?.position?.index ?? -1;
    expect(index).toBeGreaterThanOrEqual(298);
    expect(index).toBeLessThanOrEqual(301);
    expect(mapProps?.position?.distance).toBe(DATA.distance[index]);
    expect(mapProps?.position?.time).toBe(DATA.time[index]);
    await act(async () => chartSvg(root).props.onPointerLeave());
    expect(mapProps?.position).toBeNull();
  });

  it('moves the crosshair to the sample under the track pointer and reads its distance and time', async () => {
    const root = await mount();
    await act(async () => mapProps?.onPosition({ index: 100, time: 0, distance: 0 }));
    const reading = textOf(byId(root, 'crosshair-reading')[0]!);
    expect(reading).toContain(km(DATA.distance[100]) as string);
    expect(hosts(root, 'line').some((line) => line.props.className === 'crosshair')).toBe(true);
    expect(mapProps?.position?.time).toBe(DATA.time[100]);
  });

  it('passes a brush to the map and reads out the averages over it, until the zoom is reset', async () => {
    const root = await mount();
    expect(byId(root, 'range-readout')).toHaveLength(0);
    await act(async () => chartSvg(root).props.onPointerDown(pointer(pixelAt(root, 0.25))));
    await act(async () => chartSvg(root).props.onPointerMove(pointer(pixelAt(root, 0.5))));
    await act(async () => chartSvg(root).props.onPointerUp(pointer(pixelAt(root, 0.5))));
    const range = mapProps?.range;
    expect(range).toBeTruthy();
    expect(range!.to).toBeGreaterThan(range!.from);
    const readout = textOf(byId(root, 'range-readout')[0]!);
    expect(readout).toContain('connectPage.chart.power');
    expect(readout).toContain('connectPage.chart.heartRate');
    expect(readout).toContain(
      km(DATA.distance[range!.to]! - DATA.distance[range!.from]!) as string
    );
    const reset = hosts(root, 'button').find((b) => textOf(b) === 'connectPage.chart.reset');
    await act(async () => reset!.props.onClick());
    expect(mapProps?.range).toBeNull();
    expect(byId(root, 'range-readout')).toHaveLength(0);
  });
});

describe('the stream chips', () => {
  const chip = (root: ReactTestRenderer, label: string) =>
    hosts(root, 'button').find(
      (b) => b.props['aria-pressed'] !== undefined && textOf(b).includes(label)
    )!;

  it('start with every recorded stream on, and drop a lane when its chip is turned off', async () => {
    const root = await mount();
    expect(lanesOf(root)).toEqual(['altitude', 'heartrate', 'watts', 'grade']);
    expect(chip(root, 'connectPage.chart.power').props['aria-pressed']).toBe(true);
    await act(async () => chip(root, 'connectPage.chart.power').props.onClick());
    expect(lanesOf(root)).toEqual(['altitude', 'heartrate', 'grade']);
    expect(chip(root, 'connectPage.chart.power').props['aria-pressed']).toBe(false);
    await act(async () => chip(root, 'connectPage.chart.power').props.onClick());
    expect(lanesOf(root)).toEqual(['altitude', 'heartrate', 'watts', 'grade']);
  });

  it('draw no chip for a stream the ride did not record', async () => {
    const root = await mount();
    const labels = hosts(root, 'button')
      .filter((b) => b.props['aria-pressed'] !== undefined)
      .map(textOf)
      .join('|');
    expect(labels).not.toContain('connectPage.chart.cadence');
  });
});

describe('colouring the track', () => {
  it('leaves the line plain until grade is chosen, then hands the map the grade and distance streams, and takes them back on None', async () => {
    const root = await mount();
    expect(mapProps?.colour ?? null).toBeNull();
    const choice = hosts(byId(root, 'activity-colour')[0]!, 'button').find((b) =>
      textOf(b).includes('connectPage.chart.grade')
    )!;
    await act(async () => choice.props.onClick());
    expect(mapProps?.colour?.stream).toBe('grade');
    expect(mapProps?.colour?.values).toHaveLength(SAMPLES);
    expect(mapProps?.colour?.distance).toBe(DATA.distance);
    await act(async () => hosts(byId(root, 'activity-colour')[0]!, 'button')[0]!.props.onClick());
    expect(mapProps?.colour ?? null).toBeNull();
  });

  const choose = async (root: ReactTestRenderer, label: string) => {
    const choice = hosts(byId(root, 'activity-colour')[0]!, 'button').find((b) =>
      textOf(b).includes(label)
    )!;
    await act(async () => choice.props.onClick());
  };

  it('colours by power and heart rate with the activity’s own zone bounds, and by speed', async () => {
    const root = await mount({
      data: { ...DATA, series: { ...DATA.series, velocity: wave(8, 2) } },
      detailData: {
        ...DETAIL,
        powerZones: [
          { zone: 1, minWatts: 0, maxWatts: 150 },
          { zone: 2, minWatts: 150, maxWatts: null },
        ],
        hrZones: [
          { zone: 1, minBpm: 0, maxBpm: 130 },
          { zone: 2, minBpm: 130, maxBpm: 190 },
        ],
      } as unknown as DetailData,
    });
    await choose(root, 'connectPage.chart.power');
    expect(mapProps?.colour?.stream).toBe('power');
    expect(mapProps?.colour?.values).toBe(DATA.series['watts']);
    expect(mapProps?.colour?.zones).toEqual([
      { zone: 1, upper: 150 },
      { zone: 2, upper: null },
    ]);
    await choose(root, 'connectPage.chart.heartRate');
    expect(mapProps?.colour?.stream).toBe('heartrate');
    expect(mapProps?.colour?.zones).toEqual([
      { zone: 1, upper: 130 },
      { zone: 2, upper: 190 },
    ]);
    await choose(root, 'connectPage.chart.speed');
    expect(mapProps?.colour?.stream).toBe('speed');
    expect(mapProps?.colour?.zones).toBeUndefined();
  });

  it('offers power only when the activity has power zones', async () => {
    const root = await mount();
    const labels = hosts(byId(root, 'activity-colour')[0]!, 'button').map(textOf);
    expect(labels.join('|')).not.toContain('connectPage.chart.power');
  });

  it('offers no colouring for a ride with no stream to colour by', async () => {
    const { grade: _grade, watts: _watts, heartrate: _heartrate, ...series } = DATA.series;
    const root = await mount({ data: { ...DATA, series } });
    expect(byId(root, 'activity-colour')).toHaveLength(0);
  });
});

describe('the pace lane', () => {
  const RUN = { ...RECORD, sportType: 'Run' } as unknown as FfiActivityRecord;
  const withSpeed = { ...DATA, series: { ...DATA.series, velocity: wave(3, 0.5) } };

  it('is listed for a run beside speed, and for a ride not at all', async () => {
    const run = lanesOf(await mount({ record: RUN, data: withSpeed }));
    expect(run).toContain('pace');
    expect(run).toContain('velocity');
    expect(lanesOf(await mount({ data: withSpeed }))).not.toContain('pace');
  });

  it('writes a pace as minutes and seconds per kilometre', () => {
    expect(paceText(5.4)).toBe('5:24');
    expect(paceText(4)).toBe('4:00');
    expect(paceText(4.999)).toBe('5:00');
  });
});

describe('an activity with no GPS', () => {
  it('shows an empty state in the map’s place and draws no map', async () => {
    const root = await mount({
      detailData: { ...DETAIL, hasGpsTrack: false } as DetailData,
    });
    expect(mapProps).toBeNull();
    expect(textOf(byId(root, 'map-empty')[0]!)).toContain('connectPage.activity.noTrack');
    expect(byId(root, 'activity-top')[0]!.props['data-map']).toBe('none');
    expect(lanesOf(root).length).toBeGreaterThan(0);
  });

  it('draws the map while the detail read is still on its way', async () => {
    const root = await mount({ detailData: undefined });
    expect(mapProps).not.toBeNull();
    expect(byId(root, 'map-empty')).toHaveLength(0);
  });
});

describe('the figures', () => {
  it('stand in labelled groups beside the map, each figure a term and its value', async () => {
    const root = await mount({
      detail: {
        id: 'ride-3',
        movingTime: 3_600,
        elapsedTime: 3_700,
        averageSpeed: 6.9,
        maxSpeed: 12,
      },
    });
    const groups = byId(root, 'activity-summary')[0]!;
    const sections = hosts(groups, 'section').filter((s) => s.props['data-group']);
    expect(sections.map((s) => s.props['data-group'])).toEqual([
      'time',
      'speed',
      'heartRate',
      'power',
    ]);
    const terms = hosts(sections[0]!, 'dt').map(textOf);
    expect(terms).toEqual([
      'connectPage.facts.distance',
      'connectPage.facts.movingTime',
      'connectPage.facts.elapsedTime',
      'connectPage.facts.climbing',
    ]);
  });
});

describe('the tabs under the charts', () => {
  const INTERVALS = [
    { name: 'Climb', time: '5 min', distance: '2.0 km', portion: { from: 40, to: 120 } },
    { name: 'Rest', time: '2 min', distance: '0.5 km', portion: { from: 121, to: 160 } },
  ];
  const PASSES = [
    {
      id: 'col',
      name: 'Col',
      lapTime: '4:10',
      rank: 1,
      pr: true,
      history: [260, 250, 240],
      current: 2,
    },
    { id: 'ford', name: 'Ford', lapTime: '0:50', rank: null, pr: false, history: [50], current: 0 },
  ];

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      location: { hash: '#/activity/ride-3', assign: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const tabsOf = (root: ReactTestRenderer) =>
    hosts(root, 'button')
      .filter((button) => button.props.role === 'tab')
      .map((button) => button.props.id);
  const openTab = async (root: ReactTestRenderer, id: string) => {
    const tab = hosts(root, 'button').find((button) => button.props.id === `tab-${id}`)!;
    await act(async () => {
      tab.props.onClick();
    });
  };
  const rowsOf = (root: ReactTestRenderer) =>
    root.root.findAll((node) => node.type === 'tr' && node.props['data-row'] !== undefined);

  it('offers only the tabs whose data the activity has', async () => {
    expect(tabsOf(await mount())).toEqual([]);
    const root = await mount({ facts: { intervals: INTERVALS, passes: PASSES } });
    expect(tabsOf(root)).toEqual(['tab-intervals', 'tab-sections']);
  });

  it('lists one row per pass in track order under Sections', async () => {
    const root = await mount({ facts: { intervals: INTERVALS, passes: PASSES } });
    await openTab(root, 'sections');
    expect(rowsOf(root).map((row) => row.props['data-row'])).toEqual(['col', 'ford']);
    expect(textOf(rowsOf(root)[0]!)).toContain('4:10');
  });

  it('colours each interval row by the zone band it carries, and leaves a row with none uncoloured', async () => {
    const root = await mount({
      facts: { intervals: [{ ...INTERVALS[0]!, band: 3 }, INTERVALS[1]!] },
    });
    expect(rowsOf(root).map((row) => row.props['data-zone'])).toEqual(['3', undefined]);
  });

  it('brushes the chart and the map to an interval when its row is chosen, and lifts it on a second choice', async () => {
    const root = await mount({ facts: { intervals: INTERVALS, passes: PASSES } });
    await act(async () => {
      rowsOf(root)[0]!.props.onClick({});
    });
    expect(mapProps!.range).toEqual({ from: 40, to: 120 });
    expect(byId(root, 'range-readout')).toHaveLength(1);
    await act(async () => {
      rowsOf(root)[0]!.props.onClick({});
    });
    expect(mapProps!.range).toBeNull();
  });
});
