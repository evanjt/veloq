/**
 * Scenario: the activity page stacks every recorded stream in a lane on one x
 * axis, and the fitness page draws dated scatters, calendars and curves, in
 * cards of any width.
 *
 * Expected behaviour: the drawing takes the width its element measures and its
 * text is 12 px; every axis label and title lies inside the drawing at 320 and
 * 1600 px; a lane is drawn for each stream with samples, W'bal and grade among
 * them; one crosshair runs through every lane and the readout names each lane;
 * a brush reports the sample indexes it covers and a reset reports null; a
 * scatter by date spaces its dots by days and draws a trend.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ActivityPage } from '../../../web/connect/pages/ActivityPage';
import { Calendar } from '../../../web/connect/charts/Calendar';
import { Chart } from '../../../web/connect/charts/Chart';
import { Curve } from '../../../web/connect/charts/Curve';
import { factsOfDetail } from '../../../web/connect/activity';
import { Histogram } from '../../../web/connect/charts/Histogram';
import { ValueGrid } from '../../../web/connect/charts/Axes';
import { Lanes } from '../../../web/connect/charts/Lanes';
import { Sparkline } from '../../../web/connect/charts/Sparkline';
import {
  TEXT_PX,
  chartMargins,
  estimateWidth,
  plotBox,
  sparkPoints,
  tooltipLeft,
} from '../../../web/connect/charts/scale';
import type { ChartData } from '../../../web/connect/chart';
import type { FfiActivityRecord } from '../../../web/connect/schema';

const RECORD = {
  id: 'ride-3',
  name: 'Lake loop',
  sportType: 'Ride',
  startDateLocal: '2026-05-02T08:00:00',
} as unknown as FfiActivityRecord;

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
    velocity: wave(8, 2),
    wbal: wave(14_000, 6_000),
    grade: wave(0, 5),
    gap: wave(5, 1),
  },
};
const LANE_KEYS = ['altitude', 'heartrate', 'watts', 'velocity', 'gap', 'grade', 'wbal'];

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

async function mount(element: React.ReactElement, width?: number) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(element, {
      createNodeMock: () => ({
        getBoundingClientRect: () => ({ width: width ?? 640, left: 0 }),
      }),
    });
  });
  return root;
}

const hosts = (from: ReactTestRenderer | ReactTestInstance, type: string) =>
  ('root' in from ? from.root : from).findAll((node) => node.type === type);
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
const num = (value: unknown) => Number(value);

/** Where a text node's glyphs lie: its left and right edges in the drawing. */
function extent(node: ReactTestInstance) {
  const text = textOf(node);
  const w = estimateWidth(text);
  const x = num(node.props.x);
  const anchor = node.props.textAnchor;
  const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  return { text, left, right: left + w, y: num(node.props.y) };
}

const page = (onRange?: (range: unknown) => void) => (
  <ActivityPage
    id="ride-3"
    record={RECORD}
    detail={undefined}
    data={DATA}
    {...(onRange ? { onRange } : {})}
  />
);

describe.each([320, 1600])('the activity page lanes at %i px', (width) => {
  it('draws at the measured width with 12 px text and keeps every label inside', async () => {
    const root = await mount(page(), width);
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    expect(svg).toBeDefined();
    expect(num(svg!.props.width)).toBe(width);
    expect(num(svg!.props.fontSize)).toBe(12);
    const height = num(svg!.props.height);
    const texts = hosts(svg!, 'text');
    expect(texts.length).toBeGreaterThan(LANE_KEYS.length * 2);
    for (const node of texts) {
      const { text, left, right, y } = extent(node);
      expect({ text, inside: left >= 0 && right <= width }).toEqual({ text, inside: true });
      expect({ text, below: y >= 0 && y <= height }).toEqual({ text, below: true });
    }
  });
});

describe('lanes without a controlled crosshair', () => {
  it('keeps its own crosshair when the page passes no position', async () => {
    const root = await mount(
      <Lanes
        xs={[0, 1, 2, 3]}
        xKind="number"
        xFormat={(i) => `day ${i}`}
        xTitle="Day"
        lanes={[
          {
            key: 'hrv',
            name: 'HRV',
            unit: 'ms',
            colour: 'var(--chart-a)',
            values: [50, 52, 48, 55],
          },
        ]}
        label="Wellness"
        none="–"
        width={640}
      />
    );
    const [svg] = hosts(root, 'svg').filter((s) => s.props.role === 'group');
    await act(async () => {
      svg!.props.onPointerMove({
        clientX: 300,
        currentTarget: { getBoundingClientRect: () => ({ left: 0 }) },
      });
    });
    expect(hosts(root, 'line').filter((l) => l.props.className === 'crosshair')).toHaveLength(1);
  });
});

describe('lanes without a controlled crosshair', () => {
  it('keeps its own crosshair when the page passes no position', async () => {
    const root = await mount(
      <Lanes
        xs={[0, 1, 2, 3]}
        xKind="number"
        xFormat={(i) => `day ${i}`}
        xTitle="Day"
        lanes={[
          {
            key: 'hrv',
            name: 'HRV',
            unit: 'ms',
            colour: 'var(--chart-a)',
            values: [50, 52, 48, 55],
          },
        ]}
        label="Wellness"
        none="–"
        width={640}
      />
    );
    const [svg] = hosts(root, 'svg').filter((s) => s.props.role === 'group');
    await act(async () => {
      svg!.props.onPointerMove({
        clientX: 300,
        currentTarget: { getBoundingClientRect: () => ({ left: 0 }) },
      });
    });
    expect(hosts(root, 'line').filter((l) => l.props.className === 'crosshair')).toHaveLength(1);
  });
});

describe('the activity page lanes', () => {
  it('draws a lane for each stream with samples, W balance and grade included, each titled with its unit', async () => {
    const root = await mount(page());
    const lanes = hosts(root, 'g').filter((g) => g.props['data-lane']);
    expect(lanes.map((g) => g.props['data-lane'])).toEqual(LANE_KEYS);
    const titles = hosts(root, 'text')
      .filter((n) => n.props.className === 'title')
      .map(textOf);
    expect(titles).toEqual(
      expect.arrayContaining([
        'connectPage.chart.power (W)',
        'connectPage.chart.heartRate (bpm)',
        'connectPage.chart.wbal (kJ)',
        'connectPage.chart.grade (%)',
      ])
    );
  });

  it('runs one crosshair through every lane and reads every lane out', async () => {
    const root = await mount(page());
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    await act(async () => {
      svg!.props.onPointerMove({
        clientX: 300,
        currentTarget: { getBoundingClientRect: () => ({ left: 0 }) },
      });
    });
    expect(hosts(root, 'line').filter((l) => l.props.className === 'crosshair')).toHaveLength(1);
    expect(hosts(root, 'circle').filter((c) => c.props.className === 'crosshair-dot')).toHaveLength(
      LANE_KEYS.length
    );
    const readout = textOf(hosts(root, 'p').find((p) => p.props.className === 'readout')!);
    // The tooling project holds no locale resources, so the readout carries each lane's key.
    for (const name of ['elevation', 'heartRate', 'power', 'speed', 'grade', 'wbal']) {
      expect(readout).toContain(`connectPage.chart.${name}`);
    }
    const xs = new Set(
      hosts(root, 'circle')
        .filter((c) => c.props.className === 'crosshair-dot')
        .map((c) => c.props.cx)
    );
    expect(xs.size).toBe(1);
  });

  it('reports the samples a brush covers, zooms every lane to them and reports null on reset', async () => {
    const ranges: unknown[] = [];
    const root = await mount(page((range) => ranges.push(range)));
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    const target = { getBoundingClientRect: () => ({ left: 0 }) };
    const event = (clientX: number) => ({
      clientX,
      button: 0,
      pointerId: 1,
      currentTarget: { ...target, setPointerCapture: () => undefined },
    });
    await act(async () => svg!.props.onPointerDown(event(200)));
    await act(async () => svg!.props.onPointerMove(event(320)));
    await act(async () => svg!.props.onPointerUp(event(320)));
    expect(ranges).toHaveLength(1);
    const range = ranges[0] as { from: number; to: number };
    expect(range.from).toBeGreaterThan(0);
    expect(range.to).toBeGreaterThan(range.from);
    expect(range.to).toBeLessThan(SAMPLES - 1);
    const reset = hosts(root, 'button').find((b) => textOf(b) === 'connectPage.chart.reset');
    expect(reset).toBeDefined();
    await act(async () => reset!.props.onClick());
    expect(ranges).toEqual([range, null]);
    expect(
      hosts(root, 'button').find((b) => textOf(b) === 'connectPage.chart.reset')
    ).toBeUndefined();
  });

  it('treats a click without a drag as no brush', async () => {
    const ranges: unknown[] = [];
    const root = await mount(page((range) => ranges.push(range)));
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    const event = (clientX: number) => ({
      clientX,
      button: 0,
      pointerId: 1,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0 }),
        setPointerCapture: () => undefined,
      },
    });
    await act(async () => svg!.props.onPointerDown(event(250)));
    await act(async () => svg!.props.onPointerUp(event(251)));
    expect(ranges).toEqual([]);
  });
});

/** A line over a date axis in milliseconds, as the engine's read gives it. */
const LOAD_TREND = { slope: 1e-9, intercept: -1_700_000_000_000 * 1e-9 + 60, spread: 5 };

describe('a scatter by date', () => {
  const DAYS = ['2026-01-01', '2026-01-02', '2026-03-01', '2026-03-02'];
  const element = (width: number) => (
    <Chart
      kind="scatter"
      categories={DAYS}
      x={{ values: DAYS.map((day) => Date.parse(day)), kind: 'time' }}
      series={[{ name: 'Ride', colour: 'var(--sport-ride)', values: [40, 55, 70, 90] }]}
      format={(v) => String(Math.round(v))}
      xTitle="Date"
      yTitle="Load (load)"
      label="Activities by load"
      empty="none"
      none="–"
      trend={LOAD_TREND}
      width={width}
    />
  );

  it('spaces dots by the days between them and draws a trend band', async () => {
    const root = await mount(element(600));
    const dots = hosts(root, 'circle').filter((c) => c.props.className?.startsWith('mark-dot'));
    expect(dots).toHaveLength(4);
    const cx = dots.map((d) => num(d.props.cx));
    const first = cx[1]! - cx[0]!;
    const gap = cx[2]! - cx[1]!;
    // Jan 2 to Mar 1 is 58 days against 1 day from Jan 1 to Jan 2.
    expect(gap / first).toBeCloseTo(58, 0);
    expect(hosts(root, 'path').some((p) => p.props.className === 'trend-band')).toBe(true);
    expect(hosts(root, 'line').some((l) => l.props.className === 'trend-line')).toBe(true);
  });

  it('draws a step line that holds each value until the next date and runs on to the last', async () => {
    const stepped = (
      <Chart
        kind="scatter"
        categories={DAYS}
        x={{ values: DAYS.map((day) => Date.parse(day)), kind: 'time' }}
        series={[{ name: 'Ride', colour: 'var(--sport-ride)', values: [90, 70, 55, 40] }]}
        steps={{
          name: 'Record',
          colour: 'var(--sport-run)',
          points: [
            [Date.parse(DAYS[0]!), 90],
            [Date.parse(DAYS[2]!), 55],
          ],
        }}
        format={(v) => String(Math.round(v))}
        label="Activities by load"
        empty="none"
        none="–"
        width={600}
      />
    );
    const root = await mount(stepped);
    const path = hosts(root, 'path').find((p) => String(p.props.className).includes('mark-steps'));
    // Move to the first step, hold across to the second date, drop to its value, hold to the end.
    expect(String(path?.props.d)).toMatch(/^M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+$/);
    const legend = hosts(root, 'li').flatMap((li) =>
      li.children.filter((child) => typeof child === 'string')
    );
    expect(legend).toContain('Record');
    const none = await mount(
      <Chart
        kind="scatter"
        categories={DAYS}
        x={{ values: DAYS.map((day) => Date.parse(day)), kind: 'time' }}
        series={[{ name: 'Ride', colour: 'var(--sport-ride)', values: [90, 70, 55, 40] }]}
        steps={{ name: 'Record', colour: 'var(--sport-run)', points: [] }}
        format={(v) => String(Math.round(v))}
        label="Activities by load"
        empty="none"
        none="–"
        width={600}
      />
    );
    expect(hosts(none, 'path').some((p) => String(p.props.className).includes('mark-steps'))).toBe(
      false
    );
  });

  it.each([320, 1600])('keeps every label inside a drawing %i px wide', async (width) => {
    const root = await mount(element(width));
    for (const node of hosts(root, 'text')) {
      const { text, left, right } = extent(node);
      expect({ text, inside: left >= 0 && right <= width }).toEqual({ text, inside: true });
    }
  });

  it('shows the readout of the dot under the pointer', async () => {
    const root = await mount(element(600));
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    await act(async () => {
      svg!.props.onPointerMove({
        clientX: 590,
        currentTarget: { getBoundingClientRect: () => ({ left: 0 }) },
      });
    });
    expect(textOf(hosts(root, 'p').find((p) => p.props.className === 'readout')!)).toContain('90');
  });
});

describe('the other kinds', () => {
  it.each([320, 1600])('draws a curve whose labels fit %i px', async (width) => {
    const root = await mount(
      <Curve
        xs={[1, 5, 30, 60, 300, 1200, 3600]}
        ys={[1200, 900, 600, 480, 330, 270, 230]}
        xTicks={[1, 5, 15, 30, 60, 300, 1200, 3600]}
        xFormat={(s) => `${s} s`}
        yFormat={(w) => String(w)}
        xTitle="Duration"
        yTitle="Power (W)"
        colour="var(--colour-stream-power)"
        label="Power curve"
        empty="none"
        readout={(x, y) => `${x} s ${y} W`}
        width={width}
      />
    );
    const texts = hosts(root, 'text');
    expect(texts.length).toBeGreaterThan(4);
    for (const node of texts) {
      const { text, left, right } = extent(node);
      expect({ text, inside: left >= 0 && right <= width }).toEqual({ text, inside: true });
    }
  });

  it('draws a histogram bar per bin and a calendar cell per day, and says so when empty', async () => {
    const histogram = await mount(
      <Histogram
        values={[1, 2, 2, 3, 3, 3, 8]}
        bins={4}
        format={String}
        count={String}
        binText={(a, b, n) => `${a}–${b}: ${n}`}
        xTitle="Load"
        yTitle="Activities"
        colour="var(--colour-chart-series)"
        label="Distribution"
        empty="none"
        width={400}
      />
    );
    expect(hosts(histogram, 'rect').filter((r) => r.props.className === 'mark-bar')).toHaveLength(
      4
    );

    const days = ['2026-11-09', '2026-11-10', '2026-11-16'].map((date, i) => ({
      date,
      intensity: i + 1,
    }));
    const calendar = await mount(
      <Calendar days={days} dayText={(d) => d} label="Calendar" empty="none" width={500} />
    );
    expect(
      hosts(calendar, 'rect').filter((r) => String(r.props.className).startsWith('day'))
    ).toHaveLength(3);

    const empty = await mount(
      <Calendar days={[]} dayText={(d) => d} label="Calendar" empty="No days" width={500} />
    );
    expect(
      textOf(
        empty.root.findAll(
          (node) => typeof node.type === 'string' && node.props.className === 'ui-state'
        )[0]!
      )
    ).toBe('No days');
  });
});

describe('the hover tooltip', () => {
  it.each([320, 1600])('stays inside the plot at either end at %i px', (width) => {
    const box = { left: 40, right: width - 12 };
    for (const x of [box.left, (box.left + box.right) / 2, box.right]) {
      const left = tooltipLeft(x, 140, box.left, box.right);
      expect(left).toBeGreaterThanOrEqual(box.left);
      expect(left + 140).toBeLessThanOrEqual(box.right);
    }
  });

  it('sits beside the crosshair, right of it when there is room and left of it when not', () => {
    expect(tooltipLeft(100, 140, 40, 600)).toBeGreaterThan(100);
    expect(tooltipLeft(590, 140, 40, 600) + 140).toBeLessThanOrEqual(590);
  });

  it('is drawn beside the crosshair with the readout, and gone when the pointer leaves', async () => {
    const days = ['2026-01-01', '2026-01-02', '2026-03-01', '2026-03-02'];
    const root = await mount(
      <Chart
        kind="scatter"
        categories={days}
        x={{ values: days.map((day) => Date.parse(day)), kind: 'time' }}
        series={[{ name: 'Ride', colour: 'var(--sport-ride)', values: [40, 55, 70, 90] }]}
        format={(v) => String(Math.round(v))}
        label="Activities by load"
        empty="none"
        none="–"
        width={600}
      />
    );
    const tip = () => hosts(root, 'div').find((d) => d.props.className === 'chart-tooltip');
    expect(tip()).toBeUndefined();
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    await act(async () => {
      svg!.props.onPointerMove({
        clientX: 590,
        currentTarget: { getBoundingClientRect: () => ({ left: 0 }) },
      });
    });
    expect(textOf(tip()!)).toContain('90');
    await act(async () => svg!.props.onPointerLeave());
    expect(tip()).toBeUndefined();
  });
});

describe('a brush on the lanes', () => {
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

  it('keeps the sections whose portion meets the brushed samples and restores them on reset', async () => {
    const sections = [
      { id: 's1', name: 'Early climb', portion: { from: 0, to: 5 } },
      { id: 's2', name: 'Lake straight', portion: { from: 100, to: 400 } },
      { id: 's3', name: 'Unplaced' },
    ];
    const root = await mount(
      <ActivityPage
        id="ride-3"
        record={RECORD}
        detail={undefined}
        data={DATA}
        facts={{ sections }}
      />
    );
    const names = () =>
      hosts(root, 'a')
        .map(textOf)
        .filter((n) => ['Early climb', 'Lake straight', 'Unplaced'].includes(n));
    expect(names()).toHaveLength(3);
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    const event = (clientX: number) => ({
      clientX,
      button: 0,
      pointerId: 1,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0 }),
        setPointerCapture: () => undefined,
      },
    });
    await act(async () => svg!.props.onPointerDown(event(300)));
    await act(async () => svg!.props.onPointerMove(event(420)));
    await act(async () => svg!.props.onPointerUp(event(420)));
    expect(names()).toEqual(['Lake straight']);
    const reset = hosts(root, 'button').find((b) => textOf(b) === 'connectPage.chart.reset');
    await act(async () => reset!.props.onClick());
    expect(names()).toHaveLength(3);
  });
});

describe('the laps follow a brush on the lanes', () => {
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

  const brushEvent = (clientX: number) => ({
    clientX,
    button: 0,
    pointerId: 1,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0 }),
      setPointerCapture: () => undefined,
    },
  });

  it("carries each lap's sample range from the engine read", () => {
    const lap = (id: number, startIndex: number, endIndex: number) => ({
      id,
      kind: 'work',
      zone: null,
      startTime: null,
      endTime: null,
      startIndex,
      endIndex,
      averageWatts: null,
      averageHeartrate: null,
      averageSpeed: null,
      movingTime: 60,
      distance: 1000,
      label: `Lap ${id}`,
    });
    const facts = factsOfDetail(
      { intervals: { intervals: [lap(1, 0, 5), lap(2, 100, 400)] } } as never,
      undefined,
      'ride-3'
    );
    expect(facts.intervals?.map((row) => row.portion)).toEqual([
      { from: 0, to: 5 },
      { from: 100, to: 400 },
    ]);
  });

  it('keeps every lap listed through a brush, since a chosen lap is what sets the range', async () => {
    const intervals = [
      { name: 'Opening lap', time: '1:00', distance: '1 km', portion: { from: 0, to: 5 } },
      { name: 'Middle lap', time: '2:00', distance: '2 km', portion: { from: 100, to: 400 } },
    ];
    const root = await mount(
      <ActivityPage
        id="ride-3"
        record={RECORD}
        detail={undefined}
        data={DATA}
        facts={{ intervals }}
      />
    );
    const shown = () =>
      ['Opening lap', 'Middle lap'].filter(
        (name) =>
          root.root.findAll((n) => typeof n.type === 'string' && textOf(n) === name).length > 0
      );
    expect(shown()).toHaveLength(2);
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    await act(async () => svg!.props.onPointerDown(brushEvent(300)));
    await act(async () => svg!.props.onPointerMove(brushEvent(420)));
    await act(async () => svg!.props.onPointerUp(brushEvent(420)));
    expect(shown()).toHaveLength(2);
    const reset = hosts(root, 'button').find((b) => textOf(b) === 'connectPage.chart.reset');
    await act(async () => reset!.props.onClick());
    expect(shown()).toHaveLength(2);
  });
});

describe('a lane title', () => {
  it('is written inside its plot at the top left, and takes no row above the plot', async () => {
    const root = await mount(page());
    const titles = hosts(root, 'text').filter((n) => n.props.className === 'title');
    const plots = hosts(root, 'rect').filter((r) => r.props.className === 'plot');
    const lanes = plots.filter((_, i) => i < LANE_KEYS.length);
    expect(lanes).toHaveLength(LANE_KEYS.length);
    const inside = titles
      .filter((t) => t.props.textAnchor === 'start')
      .map((t) =>
        LANE_KEYS.some((_, i) => {
          const box = lanes[i]!.props;
          return (
            num(t.props.x) >= num(box.x) &&
            num(t.props.x) <= num(box.x) + 12 &&
            num(t.props.y) > num(box.y) &&
            num(t.props.y) < num(box.y) + 24
          );
        })
      );
    expect(inside).toHaveLength(LANE_KEYS.length);
    expect(inside.every(Boolean)).toBe(true);
    // The first plot starts just under the drawing's top edge rather than below a title row.
    expect(num(lanes[0]!.props.y)).toBeLessThanOrEqual(12);
  });
});

describe('the lanes tooltip', () => {
  it('appears beside the shared crosshair with the readout and is gone when the pointer leaves', async () => {
    const root = await mount(page());
    const tip = () => hosts(root, 'div').find((d) => d.props.className === 'chart-tooltip');
    expect(tip()).toBeUndefined();
    const [svg] = hosts(root, 'svg').filter(
      (s) => s.props.role === 'group' && s.props['aria-label']
    );
    await act(async () => {
      svg!.props.onPointerMove({
        clientX: 300,
        currentTarget: { getBoundingClientRect: () => ({ left: 0 }) },
      });
    });
    const crosshair = hosts(root, 'line').find((l) => l.props.className === 'crosshair')!;
    const text = textOf(tip()!);
    expect(text).toContain('connectPage.chart.power');
    expect(num(tip()!.props.style.left)).toBeGreaterThan(num(crosshair.props.x1));
    await act(async () => svg!.props.onPointerLeave());
    expect(tip()).toBeUndefined();
  });
});

// A text's box is its font's line box: the ascent and descent Manrope declares,
// 1.066 and 0.3 em. Every glyph lies inside it, so boxes that do not meet cannot
// have ink that touches.
const LINE = { ascent: 1.066, descent: 0.3 };

function lineBox(node: ReactTestInstance) {
  const { text, left, right, y } = extent(node);
  const dy =
    typeof node.props.dy === 'string' && node.props.dy.endsWith('em')
      ? Number.parseFloat(node.props.dy)
      : 0;
  const baseline = y + dy * TEXT_PX;
  return {
    text,
    left,
    right,
    top: baseline - LINE.ascent * TEXT_PX,
    bottom: baseline + LINE.descent * TEXT_PX,
  };
}

/** Each pair of texts whose line boxes meet. */
function meeting(texts: ReactTestInstance[]): string[] {
  const boxes = texts.map(lineBox);
  return boxes.flatMap((a, i) =>
    boxes
      .slice(i + 1)
      .filter((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
      .map((b) => `${a.text} / ${b.text}`)
  );
}

describe('the axis titles', () => {
  it('keep the y title clear of the top value label', async () => {
    const axis = { low: 0, high: 600, ticks: [0, 200, 400, 600] };
    const box = plotBox(
      640,
      200,
      chartMargins({ yLabels: ['600'], measure: estimateWidth, yTitle: true })
    );
    const root = await mount(
      <svg>
        <ValueGrid
          axis={axis}
          box={box}
          format={String}
          title="Elevation (m)"
          width={640}
          measure={estimateWidth}
        />
      </svg>,
      640
    );
    expect(hosts(root, 'text').length).toBeGreaterThan(3);
    expect(meeting(hosts(root, 'text'))).toEqual([]);
  });

  const DAYS = ['2026-01-01', '2026-01-02', '2026-03-01', '2026-03-02'];
  const drawings: [string, React.ReactElement][] = [
    [
      'lanes',
      <Lanes
        key="lanes"
        xs={[0, 1000, 2000, 3000, 4000]}
        xKind="number"
        xFormat={(m) => `${m / 1000} km`}
        xTitle="Distance"
        lanes={[
          {
            key: 'hr',
            name: 'Heart rate',
            unit: 'bpm',
            colour: 'var(--stream-heartrate)',
            values: [120, 135, 150, 142, 128],
          },
          {
            key: 'ele',
            name: 'Elevation',
            unit: 'm',
            colour: 'var(--stream-altitude)',
            values: [600, 640, 580, 520, 560],
          },
        ]}
        at={null}
        onAt={() => undefined}
        label="Two lanes"
        none="–"
        width={640}
      />,
    ],
    [
      'scatter',
      <Chart
        key="scatter"
        kind="scatter"
        categories={DAYS}
        x={{ values: DAYS.map((day) => Date.parse(day)), kind: 'time' }}
        series={[{ name: 'Ride', colour: 'var(--sport-ride)', values: [40, 55, 70, 90] }]}
        format={(v) => String(Math.round(v))}
        xTitle="Date"
        yTitle="Load (load)"
        label="Activities by load"
        empty="none"
        none="–"
        trend={LOAD_TREND}
        width={640}
      />,
    ],
    [
      'curve',
      <Curve
        key="curve"
        xs={[1, 5, 30, 60, 300, 1200, 3600]}
        ys={[1200, 900, 600, 480, 330, 270, 230]}
        xTicks={[1, 5, 15, 30, 60, 300, 1200, 3600]}
        xFormat={(s) => `${s} s`}
        yFormat={(w) => String(w)}
        xTitle="Duration"
        yTitle="Power (W)"
        colour="var(--colour-stream-power)"
        label="Power curve"
        empty="none"
        readout={(x, y) => `${x} s ${y} W`}
        width={640}
      />,
    ],
    [
      'histogram',
      <Histogram
        key="histogram"
        values={[1, 2, 2, 3, 3, 3, 8]}
        bins={4}
        format={String}
        count={String}
        binText={(a, b, n) => `${a}–${b}: ${n}`}
        xTitle="Load"
        yTitle="Activities"
        colour="var(--colour-chart-series)"
        label="Distribution"
        empty="none"
        width={640}
      />,
    ],
  ];

  it.each(drawings)('keep every text in the %s drawing clear of the others', async (_, element) => {
    const root = await mount(element, 640);
    expect(hosts(root, 'text').length).toBeGreaterThan(4);
    expect(meeting(hosts(root, 'text'))).toEqual([]);
  });
});

describe('Chart bands and tick labels', () => {
  const base = {
    kind: 'line' as const,
    categories: ['a', 'b', 'c'],
    series: [{ name: 'Form', colour: 'red', values: [-35, 0, 20] }],
    format: (v: number) => String(v),
    label: 'Form',
    empty: 'empty',
    none: 'none',
    width: 600,
  };
  const draw = (extra: object) => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<Chart {...base} {...extra} />);
    });
    return r;
  };

  it('draws one rect per band behind the marks, each named for assistive technology', () => {
    const r = draw({
      bands: [
        { name: 'Optimal', colour: 'green', from: -30, to: -10 },
        { name: 'Fresh', colour: 'blue', from: 5, to: 25 },
      ],
    });
    const rects = r.root.findAll((n) => n.type === 'rect' && n.props.className === 'form-band');
    expect(rects.map((n) => n.props['data-band'])).toEqual(['Optimal', 'Fresh']);
  });

  it('draws no band rect without bands', () => {
    const r = draw({});
    expect(r.root.findAll((n) => n.props.className === 'form-band')).toEqual([]);
  });

  it('labels a bar axis only where its tick label is given', () => {
    const r = draw({
      kind: 'bar',
      categories: ['2026-01-30', '2026-01-31', '2026-02-01'],
      series: [{ name: 'Load', colour: 'red', values: [1, 2, 3] }],
      tickLabels: ['Jan', null, 'Feb'],
    });
    const texts = r.root
      .findAll((n) => n.type === 'text' && n.parent?.props.className === 'axis x-axis')
      .map((n) => n.children.join(''));
    expect(texts).toEqual(['Jan', 'Feb']);
  });
});

describe('a curve with a band through its points', () => {
  const DAY_MS = 86_400_000;
  const TIMES = [0, 1, 3, 6].map((day) => Date.parse('2026-01-01') + day * DAY_MS);
  const VALUES = [60, 58, 70, 52];
  const BAND = TIMES.map((time, i) => ({
    time,
    value: VALUES[i]!,
    lower: VALUES[i]! - 5,
    upper: VALUES[i]! + 5,
  }));
  const element = (curveBand?: { points: typeof BAND }) => (
    <Chart
      kind="scatter"
      categories={TIMES.map((time) => String(time))}
      x={{ values: TIMES, kind: 'time' }}
      series={[{ name: 'Ride', colour: 'var(--sport-ride)', values: VALUES }]}
      {...(curveBand ? { curveBand } : {})}
      format={(v) => String(Math.round(v))}
      label="Attempts over time"
      empty="none"
      none="–"
      width={600}
    />
  );
  const coordinates = (d: string) =>
    [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it('draws the curve through each point and the band either side, with no least-squares line', async () => {
    const root = await mount(element({ points: BAND }));
    const dots = hosts(root, 'circle').filter((c) =>
      String(c.props.className).startsWith('mark-dot')
    );
    const curve = hosts(root, 'path').find((p) => p.props.className === 'curve-line');
    const band = hosts(root, 'path').find((p) => p.props.className === 'curve-band');
    expect(curve).toBeDefined();
    expect(band).toBeDefined();
    expect(hosts(root, 'line').some((l) => l.props.className === 'trend-line')).toBe(false);

    const line = coordinates(String(curve!.props.d));
    expect(line).toHaveLength(TIMES.length);
    line.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(num(dots[i]!.props.cx), 3);
      expect(y).toBeCloseTo(num(dots[i]!.props.cy), 3);
    });

    const edge = coordinates(String(band!.props.d));
    const n = TIMES.length;
    expect(edge).toHaveLength(2 * n);
    edge.slice(0, n).forEach(([, y], i) => expect(y).toBeLessThan(num(dots[i]!.props.cy)));
    edge.slice(n).forEach(([, y], j) => expect(y).toBeGreaterThan(num(dots[n - 1 - j]!.props.cy)));
  });

  it('draws no curve or band without points', async () => {
    const root = await mount(element());
    expect(hosts(root, 'path').some((p) => p.props.className === 'curve-line')).toBe(false);
    expect(hosts(root, 'path').some((p) => p.props.className === 'curve-band')).toBe(false);
  });
});

const pointerEvent = (clientX: number) => ({
  clientX,
  button: 0,
  pointerId: 1,
  currentTarget: {
    getBoundingClientRect: () => ({ left: 0 }),
    setPointerCapture: () => undefined,
  },
});
const plotOf = (root: ReactTestRenderer) =>
  hosts(root, 'svg').find((s) => s.props.role === 'group' && s.props['aria-label'])!;
const tipOf = (root: ReactTestRenderer) =>
  hosts(root, 'div').find((d) => d.props.className === 'chart-tooltip');
const resetOf = (root: ReactTestRenderer) =>
  hosts(root, 'button').find((b) => textOf(b) === 'connectPage.chart.reset');

describe('the curve tooltip and brush', () => {
  const curve = () => (
    <Curve
      xs={[1, 5, 30, 60, 300, 1200, 3600]}
      ys={[1200, 900, 600, 480, 330, 270, 230]}
      xTicks={[1, 5, 15, 30, 60, 300, 1200, 3600]}
      xFormat={(s) => `${s} s`}
      yFormat={(w) => String(w)}
      xTitle="Duration"
      yTitle="Power (W)"
      colour="var(--colour-stream-power)"
      label="Power curve"
      empty="none"
      readout={(x, y) => `${x} s ${y} W`}
      width={600}
    />
  );
  const lineOf = (root: ReactTestRenderer) =>
    hosts(root, 'path').find((p) => p.props.className === 'mark-line')!.props.d;

  it('shows the sample under the pointer in a tooltip beside the crosshair, gone on leave', async () => {
    const root = await mount(curve());
    expect(tipOf(root)).toBeUndefined();
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(590)));
    expect(textOf(tipOf(root)!)).toBe('3600 s 230 W');
    await act(async () => plotOf(root).props.onPointerLeave());
    expect(tipOf(root)).toBeUndefined();
  });

  it('zooms to the samples a brush covers and restores every sample on reset', async () => {
    const root = await mount(curve());
    const before = lineOf(root);
    await act(async () => plotOf(root).props.onPointerDown(pointerEvent(60)));
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(330)));
    await act(async () => plotOf(root).props.onPointerUp(pointerEvent(330)));
    expect(resetOf(root)).toBeDefined();
    expect(lineOf(root)).not.toBe(before);
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(590)));
    expect(textOf(tipOf(root)!)).not.toBe('3600 s 230 W');
    await act(async () => resetOf(root)!.props.onClick());
    expect(resetOf(root)).toBeUndefined();
    expect(lineOf(root)).toBe(before);
  });

  it('treats a click without a drag as no brush', async () => {
    const root = await mount(curve());
    await act(async () => plotOf(root).props.onPointerDown(pointerEvent(250)));
    await act(async () => plotOf(root).props.onPointerUp(pointerEvent(251)));
    expect(resetOf(root)).toBeUndefined();
  });
});

describe('the histogram tooltip and brush', () => {
  const histogram = () => (
    <Histogram
      values={[1, 2, 2, 3, 3, 3, 8, 9, 10, 10]}
      bins={4}
      format={String}
      count={String}
      binText={(a, b, n) => `${a}–${b}: ${n}`}
      xTitle="Load"
      yTitle="Activities"
      colour="var(--chart-a)"
      label="Distribution"
      empty="none"
      width={400}
    />
  );

  it('shows the bin under the pointer in a tooltip, gone on leave', async () => {
    const root = await mount(histogram());
    expect(tipOf(root)).toBeUndefined();
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(60)));
    expect(textOf(tipOf(root)!)).toBe('1–3.25: 6');
    await act(async () => plotOf(root).props.onPointerLeave());
    expect(tipOf(root)).toBeUndefined();
  });

  it('bins again over the brushed range and restores the full range on reset', async () => {
    const root = await mount(histogram());
    await act(async () => plotOf(root).props.onPointerDown(pointerEvent(60)));
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(200)));
    await act(async () => plotOf(root).props.onPointerUp(pointerEvent(200)));
    expect(resetOf(root)).toBeDefined();
    const bars = hosts(root, 'rect').filter((r) => r.props.className === 'mark-bar');
    expect(bars).toHaveLength(4);
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(60)));
    expect(textOf(tipOf(root)!)).not.toBe('1–3.25: 6');
    await act(async () => resetOf(root)!.props.onClick());
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(60)));
    expect(textOf(tipOf(root)!)).toBe('1–3.25: 6');
  });
});

describe('a histogram of bins the caller already has', () => {
  const given = [
    { low: 600, high: 630, count: 2 },
    { low: 630, high: 660, count: 0 },
    { low: 660, high: 690, count: 5 },
  ];
  const drawn = () => (
    <Histogram
      binned={given}
      format={String}
      count={String}
      binText={(a, b, n) => `${a}–${b}: ${n}`}
      xTitle="Time"
      yTitle="Laps"
      colour="var(--chart-a)"
      label="Spread"
      empty="none"
      width={400}
    />
  );
  const barsOf = (root: ReactTestRenderer) =>
    hosts(root, 'rect').filter((r) => r.props.className === 'mark-bar');

  it('draws one bar per bin it was given, including an empty one', async () => {
    const root = await mount(drawn());
    expect(barsOf(root)).toHaveLength(3);
  });

  it('writes the bin under the pointer with the bin text', async () => {
    const root = await mount(drawn());
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(60)));
    expect(textOf(tipOf(root)!)).toBe('600–630: 2');
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(390)));
    expect(textOf(tipOf(root)!)).toBe('660–690: 5');
  });

  it('keeps its bins when a range is dragged across it, with nothing to zoom', async () => {
    const root = await mount(drawn());
    await act(async () => plotOf(root).props.onPointerDown(pointerEvent(60)));
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(200)));
    await act(async () => plotOf(root).props.onPointerUp(pointerEvent(200)));
    expect(resetOf(root)).toBeUndefined();
    expect(barsOf(root)).toHaveLength(3);
    await act(async () => plotOf(root).props.onPointerMove(pointerEvent(60)));
    expect(textOf(tipOf(root)!)).toBe('600–630: 2');
  });

  it('says so when it was given no bins', async () => {
    const root = await mount(
      <Histogram
        binned={[]}
        format={String}
        count={String}
        binText={() => ''}
        xTitle="Time"
        yTitle="Laps"
        colour="var(--chart-a)"
        label="Spread"
        empty="No laps"
        width={400}
      />
    );
    expect(barsOf(root)).toHaveLength(0);
    expect(
      textOf(
        root.root.findAll(
          (node) => typeof node.type === 'string' && node.props.className === 'ui-state'
        )[0]!
      )
    ).toBe('No laps');
  });
});

describe('sparkPoints', () => {
  it('puts the low at the bottom and the high at the top, inside the inset', () => {
    expect(sparkPoints([0, 5, 10], 100, 20, { low: 0, high: 10 }, 2)).toEqual([
      { x: 2, y: 18 },
      { x: 50, y: 10 },
      { x: 98, y: 2 },
    ]);
  });

  it('draws one value mid-width and a flat range mid-height rather than dividing by zero', () => {
    expect(sparkPoints([7], 100, 20, { low: 7, high: 7 }, 2)).toEqual([{ x: 50, y: 10 }]);
    expect(sparkPoints([3, 3], 100, 20, { low: 3, high: 3 }, 2).map((p) => p.y)).toEqual([10, 10]);
  });
});

describe('the sparkline', () => {
  const spark = (width: number) => (
    <Sparkline
      className="trend"
      lines={[
        { values: [0, 4, 8], className: 'received' },
        { values: [0, 1, 2], className: 'sent' },
      ]}
      range="zero"
      height={24}
      width={width}
      label="Traffic"
    />
  );

  it.each([96, 240, 1600])(
    'is drawn at its measured width of %i px, never stretched',
    async (width) => {
      const root = await mount(spark(width));
      const [svg] = hosts(root, 'svg');
      expect(num(svg!.props.width)).toBe(width);
      expect(svg!.props.viewBox).toBe(`0 0 ${width} 24`);
      expect(svg!.props.preserveAspectRatio).toBeUndefined();
      const points = hosts(root, 'polyline').map((p) => p.props.points as string);
      expect(points).toHaveLength(2);
      expect(
        points[0]!
          .split(' ')
          .at(-1)!
          .startsWith(`${width - 2}`)
      ).toBe(true);
    }
  );

  it('draws the lines on one scale so they compare', async () => {
    const root = await mount(spark(240));
    const [received, sent] = hosts(root, 'polyline').map((p) =>
      (p.props.points as string).split(' ').map((pair) => Number(pair.split(',')[1]))
    );
    expect(received![2]).toBe(2);
    expect(sent![2]).toBeGreaterThan(received![2]!);
  });

  it('marks one point of a line', async () => {
    const root = await mount(
      <Sparkline
        lines={[{ values: [3, 9, 5] }]}
        range="fit"
        height={20}
        width={100}
        marker={{ line: 0, index: 2 }}
      />
    );
    const [dot] = hosts(root, 'circle');
    expect(num(dot!.props.cx)).toBe(98);
    expect(num(dot!.props.cy)).toBeGreaterThan(2);
  });

  it('keeps a line that is zero throughout flat at the bottom', async () => {
    const root = await mount(
      <Sparkline lines={[{ values: [0, 0, 0] }]} range="zero" height={48} width={100} />
    );
    expect(hosts(root, 'polyline')[0]!.props.points).toBe('2.0,46.0 50.0,46.0 98.0,46.0');
  });

  it('draws nothing for a line of fewer than two values', async () => {
    const root = await mount(
      <Sparkline lines={[{ values: [4] }]} range="fit" height={20} width={100} />
    );
    expect(hosts(root, 'polyline')[0]!.props.points).toBe('');
  });
});
