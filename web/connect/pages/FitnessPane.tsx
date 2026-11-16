// The fitness page, drawn from the engine's numbers. Charts are SVG in the
// page's colour variables, each with a readout that follows the pointer.

import type { ParseKeys, TFunction } from 'i18next';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FITNESS_SPORTS,
  SPORT_FAMILIES,
  dotsOnDay,
  decouplingRows,
  formOf,
  formZoneBands,
  monthTickLabels,
  type FormZone,
  sportColour,
  sportFamily,
  monthRows,
  sortMonths,
  wellnessLanes,
  type FitnessChoices,
  type MonthColumn,
  type SportFamily,
} from '../dashboard';
import { Calendar as HeatCalendar } from '../charts/Calendar';
import { Chart, type XValues } from '../charts/Chart';
import { fitnessColours, streamColour, zoneColour } from '../charts/colours';
import { Curve } from '../charts/Curve';
import { Lanes } from '../charts/Lanes';
import { DISTANCE_TICKS, DURATION_TICKS } from '../charts/scale';
import { go, type Route } from '../router';
import {
  nextOrder,
  orderRows,
  readTableOrder,
  sortProp,
  writeTableOrder,
  type Ordering,
} from '../tableOrder';
import { useTableLabels } from '../tableLabels';
import { Button, Card, CardHeader, DataTable, SegmentedControl, Tabs, type Column } from '../ui';
import { BEST_EFFORT_PERIODS, RANGES, dayOf } from '../fitness';
import type { ReadState } from '../query';
import type { Methods } from '../schema';
import type { Panels } from '../fitnessReads';
import { Reading } from '../shell/StatePanes';

type Wellness = Methods['fitness.wellness']['result'];
type Loads = Methods['fitness.loads']['result'];
type Zones = Methods['fitness.zones']['result'];
type PowerCurve = Methods['fitness.powerCurve']['result'];
type PaceCurve = Methods['fitness.paceCurve']['result'];
type Screen = Methods['fitness.screen']['result'];
type BestEfforts = Methods['fitness.bestEfforts']['result'];

type Line = { className: string; values: (number | null)[] };

const LINE_COLOURS: Record<string, string> = {
  'line-a': 'var(--chart-a)',
  'line-b': 'var(--chart-b)',
  'line-c': 'var(--primary)',
};

/**
 * A line chart over shared categories with a hover readout. `labels` are the
 * readout's heading for each position, and `format` writes one value.
 */
export function LineChart({
  labels,
  lines,
  names,
  format,
  label,
  colours,
  x,
  xTitle,
  yTitle,
  bands,
}: {
  labels: string[];
  lines: Line[];
  names: string[];
  format: (value: number) => string;
  label?: string;
  /** One colour per line, in place of the page's line colours. */
  colours?: string[];
  /** Real positions for the labels, so the axis is by time and not by order. */
  x?: XValues;
  xTitle?: string;
  yTitle?: string;
  bands?: { name: string; colour: string; from: number; to: number }[];
}) {
  const { t } = useTranslation();
  return (
    <Chart
      kind="line"
      categories={labels}
      series={lines.map((line, n) => ({
        name: names[n] ?? '',
        colour: colours?.[n] ?? LINE_COLOURS[line.className] ?? 'var(--chart-a)',
        values: line.values,
      }))}
      format={format}
      label={label ?? names.join(', ')}
      empty={t('connectPage.fitness.noData')}
      none={t('connectPage.fitness.none')}
      {...(x ? { x } : {})}
      {...(xTitle ? { xTitle } : {})}
      {...(yTitle ? { yTitle } : {})}
      {...(bands ? { bands } : {})}
    />
  );
}

/** A date axis over `YYYY-MM-DD` days, spaced by the days between them. */
const dateAxis = (days: readonly string[]): XValues => ({
  values: days.map((day) => Date.parse(day)),
  kind: 'time',
});

/** The fill of each form zone, from the zone palette. */
const FORM_ZONE_COLOURS: Record<FormZone, string> = {
  highRisk: zoneColour(7),
  optimal: zoneColour(3),
  greyZone: zoneColour(1),
  fresh: zoneColour(2),
  transition: zoneColour(5),
};

const COVERAGE_NOTES: Record<Wellness['coverage'], ParseKeys | null> = {
  loaded: null,
  empty: 'connectPage.fitness.noWellness',
  notFetched: 'connectPage.fitness.wellnessNotFetched',
};

function WellnessPanel({ data }: { data: Wellness }) {
  const { t } = useTranslation();
  const bands = formZoneBands(-1000, 1000).map((band) => ({
    name: t(`formZones.${band.zone}`),
    colour: FORM_ZONE_COLOURS[band.zone],
    from: band.from,
    to: band.to,
  }));
  const note = COVERAGE_NOTES[data.coverage];
  return (
    <>
      <LineChart
        labels={data.days.map((day) => day.date)}
        lines={[
          { className: 'line-a', values: data.days.map((day) => day.ctl) },
          { className: 'line-b', values: data.days.map((day) => day.atl) },
          { className: 'line-c', values: data.days.map(formOf) },
        ]}
        names={[
          t('connectPage.facts.fitness'),
          t('connectPage.fitness.fatigue'),
          t('connectPage.facts.form'),
        ]}
        format={(value) => value.toFixed(1)}
        colours={[fitnessColours.fitness, fitnessColours.fatigue, 'var(--primary)']}
        bands={bands}
        x={dateAxis(data.days.map((day) => day.date))}
        xTitle={t('connectPage.fitness.axisDate')}
        yTitle={`${t('connectPage.fitness.fitnessFatigue')} (${t('connectPage.fitness.loadUnit')})`}
      />
      {note ? <p className="empty">{t(note)}</p> : null}
    </>
  );
}

/** HRV, resting heart rate, sleep and weight as lanes over the same days as the fitness chart. */
function WellnessLanes({ data }: { data: Wellness }) {
  const { t } = useTranslation();
  const lanes = wellnessLanes(data.days);
  if (lanes.length === 0) return <p className="empty">{t('connectPage.fitness.noWellness')}</p>;
  const dates = data.days.map((day) => day.date);
  const meta = {
    hrv: { name: t('connectPage.fitness.hrv'), unit: 'ms', colour: 'var(--chart-a)' },
    restingHr: { name: t('connectPage.fitness.restingHr'), unit: 'bpm', colour: 'var(--chart-b)' },
    sleep: { name: t('connectPage.fitness.sleep'), unit: 'h', colour: 'var(--primary)' },
    weight: { name: t('connectPage.fitness.weight'), unit: 'kg', colour: 'var(--chart-a)' },
  } as const;
  return (
    <Lanes
      xs={dates.map((_, i) => i)}
      xKind="number"
      xFormat={(i) => dates[Math.round(i)] ?? ''}
      xTitle={t('connectPage.fitness.axisDate')}
      lanes={lanes.map((lane) => ({ key: lane.key, ...meta[lane.key], values: lane.values }))}
      at={null}
      onAt={() => undefined}
      label={t('connectPage.fitness.wellnessLanes')}
      none={t('connectPage.fitness.none')}
    />
  );
}

const sumOf = (values: (number | null)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0);

function LoadsPanel({ data }: { data: Loads }) {
  const { t, i18n } = useTranslation();
  const dates = data.days.map((day) => day.date);
  return (
    <>
      <Chart
        kind="bar"
        categories={dates}
        tickLabels={monthTickLabels(dates, i18n.language)}
        series={[
          {
            name: t('connectPage.fitness.colLoad'),
            colour: 'var(--chart-a)',
            values: data.days.map((day) => day.total),
          },
        ]}
        format={(value) => String(Math.round(value))}
        label={t('connectPage.fitness.dailyLoad')}
        xTitle={t('connectPage.fitness.axisMonth')}
        yTitle={`${t('connectPage.fitness.dailyLoad')} (${t('connectPage.fitness.loadUnit')})`}
        empty={t('connectPage.fitness.noActivities')}
        none={t('connectPage.fitness.none')}
      />
      <p className="readout">
        {t('connectPage.fitness.totalLoad', {
          load: Math.round(sumOf(data.days.map((day) => day.total))),
        })}
      </p>
    </>
  );
}

function ZonesPanel({ data }: { data: Zones }) {
  const { t } = useTranslation();
  const names = data.seconds.map(
    (_, i) => data.names[i] ?? t('connectPage.fitness.zone', { n: i + 1 })
  );
  return (
    <Chart
      kind="bar"
      categories={names}
      series={[
        {
          name: t('connectPage.fitness.colLoad'),
          colour: 'var(--chart-a)',
          values: data.seconds.map((seconds) => seconds / 3600),
        },
      ]}
      format={(hours) => `${hours.toFixed(1)} h`}
      label={t('connectPage.fitness.powerZones')}
      xTitle={t('connectPage.fitness.axisZone')}
      yTitle={`${t('connectPage.fitness.timeInZone')} (h)`}
      empty={t('connectPage.fitness.noZones')}
      none={t('connectPage.fitness.none')}
    />
  );
}

export const clock = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
      : `${Math.round(seconds)} s`;

function NotDownloaded() {
  const { t } = useTranslation();
  return <p className="empty">{t('connectPage.fitness.curveMissing')}</p>;
}

function PowerCurvePanel({ data }: { data: PowerCurve }) {
  const { t } = useTranslation();
  const curve = data.curve;
  if (!curve) return <NotDownloaded />;
  return (
    <Curve
      xs={curve.secs}
      ys={curve.watts}
      xTicks={DURATION_TICKS}
      xFormat={clock}
      yFormat={(value) => String(Math.round(value))}
      xTitle={t('connectPage.fitness.axisDuration')}
      yTitle={`${t('connectPage.chart.power')} (W)`}
      colour={streamColour('power')}
      label={t('connectPage.fitness.powerCurve')}
      empty={t('connectPage.fitness.noData')}
      readout={(secs, watts) =>
        `${clock(secs)} · ${t('connectPage.chart.power')} ${Math.round(watts)} W`
      }
    />
  );
}

const distanceText = (metres: number) => (metres >= 1000 ? `${metres / 1000} km` : `${metres} m`);

function PaceCurvePanel({ data }: { data: PaceCurve }) {
  const { t } = useTranslation();
  const curve = data.curve;
  if (!curve) return <NotDownloaded />;
  return (
    <Curve
      xs={curve.distances}
      ys={curve.times}
      xTicks={DISTANCE_TICKS}
      xFormat={distanceText}
      yFormat={clock}
      xTitle={`${t('connectPage.facts.distance')} (m)`}
      yTitle={t('connectPage.facts.time')}
      colour={streamColour('pace')}
      label={t('connectPage.fitness.paceCurve')}
      empty={t('connectPage.fitness.noData')}
      readout={(metres, seconds) =>
        `${distanceText(metres)} · ${t('connectPage.facts.time')} ${clock(seconds)}`
      }
    />
  );
}

type EffortRow = {
  id: string;
  sport: string;
  /** The checkpoint in seconds or metres, for ordering. */
  checkpoint: number | null;
  effort: string;
  best: number | null;
  bestText: string;
  activityId: string | null;
  activity: string;
  missing: boolean;
};

const EFFORT_COLUMNS = ['sport', 'effort', 'best', 'activity'] as const;
type EffortColumn = (typeof EFFORT_COLUMNS)[number];
const EFFORT_DEFAULT: Ordering<EffortColumn> = { column: 'sport', descending: false };

/** The efforts as one row each, in the engine's order. */
export function effortRows(data: BestEfforts, missingText: string): EffortRow[] {
  return data.sports.flatMap((sport): EffortRow[] =>
    !sport.fetched
      ? [
          {
            id: sport.sport,
            sport: sport.sport,
            checkpoint: null,
            effort: missingText,
            best: null,
            bestText: '',
            activityId: null,
            activity: '',
            missing: true,
          },
        ]
      : sport.efforts.map((effort, at) => {
          const power = sport.sport === 'Ride';
          const best = power ? effort.value : effort.time;
          return {
            id: `${sport.sport}-${at}`,
            sport: sport.sport,
            checkpoint: effort.checkpoint,
            effort:
              effort.kind === 'duration'
                ? clock(effort.checkpoint)
                : `${effort.checkpoint / 1000} km`,
            best,
            bestText: best === null ? '' : power ? `${Math.round(best)} W` : clock(best),
            activityId: effort.activityId ?? null,
            activity: effort.activity?.name ?? effort.activityId ?? '',
            missing: false,
          };
        })
  );
}

function BestEffortsPanel({
  data,
  route,
  onRoute,
}: {
  data: BestEfforts;
  route: Route;
  onRoute: (route: Route) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const order = readTableOrder(route, 'efforts', EFFORT_COLUMNS, EFFORT_DEFAULT);
  const rows = orderRows(
    effortRows(data, t('connectPage.fitness.effortsMissing')),
    order,
    (row, column) =>
      column === 'sport'
        ? row.sport
        : column === 'effort'
          ? row.checkpoint
          : column === 'best'
            ? row.best
            : row.activity
  );
  const heads: Record<EffortColumn, ParseKeys> = {
    sport: 'connectPage.fitness.effortSport',
    effort: 'connectPage.fitness.effortEffort',
    best: 'connectPage.fitness.effortBest',
    activity: 'connectPage.fitness.effortActivity',
  };
  const columns: Column<EffortRow>[] = EFFORT_COLUMNS.map((column) => ({
    key: column,
    header: t(heads[column]),
    sortable: true,
    numeric: column === 'best',
    clip: column === 'activity',
    ...(column === 'activity' ? { cellProps: (row: EffortRow) => ({ title: row.activity }) } : {}),
    cell: (row) =>
      column === 'sport' ? (
        row.sport
      ) : column === 'effort' ? (
        row.effort
      ) : column === 'best' ? (
        row.bestText
      ) : row.activityId ? (
        <a href={`#/activity/${encodeURIComponent(row.activityId)}`}>{row.activity}</a>
      ) : (
        row.activity
      ),
  }));
  return (
    <DataTable
      label={t('connectPage.fitness.bestEfforts')}
      tableId="efforts"
      labels={labels}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      sort={sortProp(order)}
      onSort={(key) =>
        onRoute(
          writeTableOrder(
            route,
            'efforts',
            nextOrder(order, key as EffortColumn, false),
            EFFORT_DEFAULT
          )
        )
      }
    />
  );
}

function ThresholdsPanel({ data }: { data: Screen }) {
  const { t } = useTranslation();
  const facts: [string, string | null][] = [
    [
      t('connectPage.fitness.cyclingFtp'),
      data.cyclingFtpSetting === null ? null : `${Math.round(data.cyclingFtpSetting)} W`,
    ],
    [
      t('connectPage.fitness.estimatedFtp'),
      data.ftpTrend.latestFtp === null ? null : `${Math.round(data.ftpTrend.latestFtp)} W`,
    ],
    [
      t('connectPage.fitness.runningLthr'),
      data.runningLthr === null ? null : `${Math.round(data.runningLthr)} bpm`,
    ],
    [t('connectPage.fitness.recentRides'), String(data.sportMix.rides)],
    [t('connectPage.fitness.recentRuns'), String(data.sportMix.runs)],
    [t('connectPage.fitness.recentSwims'), String(data.sportMix.swims)],
  ];
  return (
    <dl>
      {facts
        .filter(([, value]) => value !== null)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
    </dl>
  );
}

/** The daily cycling eFTP the screen read carries, oldest first. */
function EftpPanel({ data }: { data: Screen }) {
  const { t } = useTranslation();
  if (data.ftpTrendCoverage === 'notFetched') {
    return <p className="empty">{t('connectPage.fitness.wellnessNotFetched')}</p>;
  }
  const history = data.ftpTrend.history;
  const days = history.map((point) =>
    dayOf(new Date(point.date * 1000 + new Date().getTimezoneOffset() * 60000))
  );
  return (
    <LineChart
      labels={days}
      lines={[{ className: 'line-c', values: history.map((point) => point.value) }]}
      names={[t('connectPage.fitness.estimatedFtp')]}
      format={(value) => `${Math.round(value)} W`}
      x={dateAxis(days)}
      xTitle={t('connectPage.fitness.axisDate')}
      yTitle={`${t('connectPage.fitness.estimatedFtp')} (W)`}
    />
  );
}

/** The ride each span's aerobic decoupling was read from. */
function DecouplingPanel({ data }: { data: Screen }) {
  const { t } = useTranslation();
  const rows = decouplingRows(data.decouplingSources);
  if (rows.length === 0) return <p className="empty">{t('connectPage.fitness.noDecoupling')}</p>;
  return (
    <dl>
      {rows.map((row) => (
        <Fragment key={row.days}>
          <dt>{t('connectPage.fitness.days', { count: row.days })}</dt>
          <dd>
            {row.decoupling}% ·{' '}
            <a href={`#/activity/${encodeURIComponent(row.activityId)}`}>{row.name}</a> · {row.date}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The latest day's fitness, fatigue, form and ramp as a strip of tiles above the charts. */
function Tiles({ data }: { data: Wellness }) {
  const { t } = useTranslation();
  const days = data.days.filter((day) => day.ctl !== null || day.atl !== null);
  const latest = days[days.length - 1];
  if (!latest) return null;
  const one = (value: number | null) => (value === null ? '' : value.toFixed(1));
  const tiles: [string, string][] = [
    [t('connectPage.facts.fitness'), one(latest.ctl)],
    [t('connectPage.fitness.fatigue'), one(latest.atl)],
    [t('connectPage.facts.form'), one(formOf(latest))],
    [t('connectPage.fitness.ramp'), one(latest.rampRate)],
  ];
  return (
    <ul id="fitness-tiles" className="tiles">
      {tiles
        .filter(([, value]) => value !== '')
        .map(([label, value]) => (
          <li key={label}>
            <span className="tile-label">{label}</span>
            <span className="tile-value">{value}</span>
          </li>
        ))}
    </ul>
  );
}

const SPORT_NAMES = { ride: 'Ride', run: 'Run', swim: 'Swim', walk: 'Walk' } as const;

/** The sport family's name: the activity type it is named for, or "Other". */
const familyName = (t: TFunction, family: SportFamily) =>
  family === 'other' ? t('connectPage.families.other') : t(`activityTypes.${SPORT_NAMES[family]}`);
/** Moving hours per week, stacked by the engine's sport families over the weeks the read holds. */
export function WeeklyHours({ weeks }: { weeks: Screen['weeklyHours'] }) {
  const { t, i18n } = useTranslation();
  const used = [...new Set(weeks.flatMap((week) => week.hours.map((entry) => entry.family)))];
  const hoursOf = (week: Screen['weeklyHours'][number], family: string) =>
    week.hours.find((entry) => entry.family === family)?.hours ?? 0;
  return (
    <Chart
      kind="stacked"
      categories={weeks.map((week) => week.weekStart)}
      tickLabels={monthTickLabels(
        weeks.map((week) => week.weekStart),
        i18n.language
      )}
      series={used.map((family) => ({
        name: t(`connectPage.families.${family}` as ParseKeys),
        colour: `var(--colour-sport-${family})`,
        values: weeks.map((week) => hoursOf(week, family)),
      }))}
      format={(hours) => `${hours.toFixed(1)} h`}
      label={t('connectPage.fitness.hoursPerWeek')}
      xTitle={t('connectPage.fitness.axisMonth')}
      yTitle={`${t('connectPage.fitness.hoursPerWeek')} (h)`}
      empty={t('connectPage.fitness.noActivitiesSpan')}
      none={t('connectPage.fitness.none')}
    />
  );
}

/** One panel's slot: its drawing once the phone answers, its reason in place if it could not. */
function Slot<T>({
  slot,
  part,
  panels,
  draw,
}: {
  slot: string;
  /** Names the drawing when one read feeds several panels. */
  part?: string;
  panels: Panels;
  draw: (data: T) => ReactNode;
}) {
  const held = panels[slot];
  return (
    <div id={`panel-${slot}${part ? `-${part}` : ''}`}>
      {held === undefined ? null : <Reading read={held as ReadState<T>}>{draw}</Reading>}
    </div>
  );
}

function Choices({
  id,
  label,
  values,
  current,
  name,
  pick,
}: {
  id: string;
  label: string;
  values: readonly (number | string)[];
  current: number | string;
  name: (n: never) => string;
  pick: (n: never) => void;
}) {
  return (
    <SegmentedControl
      id={id}
      label={label}
      value={String(current)}
      options={values.map((value) => ({ value: String(value), label: name(value as never) }))}
      onChange={(picked) => {
        const value = values.find((v) => String(v) === picked);
        if (value !== undefined) pick(value as never);
      }}
    />
  );
}

type Dot = Screen['loadDots'][number];

/** Each activity of the longest span as a dot by start and load; a click opens it. */
function LoadDots({
  dots,
  open,
  onOpen,
}: {
  dots: Dot[];
  open: string | null;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const sorted = [...dots].sort(
    (a, b) => Date.parse(a.startDateLocal) - Date.parse(b.startDateLocal)
  );
  const families = SPORT_FAMILIES.filter((family) =>
    sorted.some((dot) => sportFamily(dot.sportType) === family)
  );
  return (
    <Chart
      kind="scatter"
      categories={sorted.map((dot) => `${dot.startDateLocal.slice(0, 10)} ${dot.name}`)}
      series={families.map((family) => ({
        name: familyName(t, family),
        colour: sportColour(family),
        values: sorted.map((dot) => (sportFamily(dot.sportType) === family ? dot.load : null)),
      }))}
      format={(value) => String(Math.round(value))}
      label={t('connectPage.fitness.activitiesByLoad')}
      x={dateAxis(sorted.map((dot) => dot.startDateLocal.slice(0, 10)))}
      trend
      xTitle={t('connectPage.fitness.axisDate')}
      yTitle={`${t('connectPage.fitness.colLoad')} (${t('connectPage.fitness.loadUnit')})`}
      empty={t('connectPage.fitness.noActivitiesSpan')}
      none={t('connectPage.fitness.none')}
      picked={open === null ? null : sorted.findIndex((dot) => dot.activityId === open)}
      onPick={(i) => {
        const dot = sorted[i];
        if (dot) onOpen(dot.activityId);
      }}
    />
  );
}

/** The heatmap days as week columns per year; a click opens that day's activity. */
function Calendar({
  days,
  dots,
  onOpen,
}: {
  days: Screen['heatmap'];
  dots: Dot[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const counts = new Map(days.map((day) => [day.date, day.activityCount]));
  return (
    <HeatCalendar
      days={days}
      dayText={(date) =>
        t('connectPage.fitness.dayActivities', { date, count: counts.get(date) ?? 0 })
      }
      onPick={(date) => {
        const [first] = dotsOnDay(dots, date);
        if (first) onOpen(first);
      }}
      label={t('connectPage.fitness.calendar')}
      empty={t('connectPage.fitness.noCalendarDays')}
    />
  );
}

const km = (metres: number) => `${(metres / 1000).toFixed(0)} km`;

const MONTH_COLUMNS: readonly MonthColumn[] = ['month', 'count', 'duration', 'distance', 'load'];
const MONTH_DEFAULT: Ordering<MonthColumn> = { column: 'month', descending: true };

export function MonthsTable({
  months,
  route,
  onRoute,
}: {
  months: Screen['months'];
  route: Route;
  onRoute: (route: Route) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const order = readTableOrder(route, 'months', MONTH_COLUMNS, MONTH_DEFAULT);
  const rows = sortMonths(monthRows(months), order.column, order.descending ? 'desc' : 'asc');
  const heads: Record<MonthColumn, string> = {
    month: t('connectPage.fitness.colMonth'),
    count: t('connectPage.fitness.colActivities'),
    duration: t('connectPage.facts.time'),
    distance: t('connectPage.facts.distance'),
    load: t('connectPage.fitness.colLoad'),
  };
  const columns: Column<ReturnType<typeof monthRows>[number]>[] = MONTH_COLUMNS.map((column) => ({
    key: column,
    header: heads[column],
    sortable: true,
    numeric: column !== 'month',
    cell: (row) =>
      column === 'month'
        ? row.key
        : column === 'count'
          ? (row.count ?? '')
          : column === 'duration'
            ? row.duration == null
              ? ''
              : clock(row.duration)
            : column === 'distance'
              ? row.distance == null
                ? ''
                : km(row.distance)
              : row.load == null
                ? ''
                : Math.round(row.load),
  }));
  return (
    <DataTable
      label={t('connectPage.fitness.months')}
      tableId="months"
      labels={labels}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      sort={sortProp(order)}
      onSort={(key) =>
        onRoute(
          writeTableOrder(
            route,
            'months',
            nextOrder(order, key as MonthColumn, true),
            MONTH_DEFAULT
          )
        )
      }
    />
  );
}

type Comparison = Screen['seasonYear'];
type ComparisonRow = { id: string; label: string; cells: string[] };

function comparisonRow(id: string, label: string, data: Comparison): ComparisonRow {
  const now = data.currentStats;
  const before = data.previousStats;
  return {
    id,
    label,
    cells: [
      String(now.count),
      String(before.count),
      clock(now.totalDuration),
      clock(before.totalDuration),
      km(now.totalDistance),
      km(before.totalDistance),
      String(Math.round(now.totalTss)),
      String(Math.round(before.totalTss)),
    ],
  };
}

function Comparisons({ data }: { data: Screen }) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const measures = [
    t('connectPage.fitness.colActivities'),
    t('connectPage.facts.time'),
    t('connectPage.facts.distance'),
    t('connectPage.fitness.colLoad'),
  ];
  const columns: Column<ComparisonRow>[] = [
    {
      key: 'period',
      header: t('connectPage.fitness.period'),
      numeric: false,
      cell: (row) => row.label,
    },
    ...measures.flatMap((title, m): Column<ComparisonRow>[] =>
      [0, 1].map((before) => ({
        key: `${m}-${before}`,
        header: before ? `${title} (${t('connectPage.fitness.previous')})` : title,
        numeric: true,
        defaultHidden: m === 0,
        cell: (row) => row.cells[m * 2 + before],
      }))
    ),
  ];
  return (
    <DataTable
      label={t('connectPage.fitness.weekAndSeason')}
      tableId="comparisons"
      labels={labels}
      columns={columns}
      rows={[
        comparisonRow('week', t('connectPage.facts.thisWeek'), data.comparisons.week),
        comparisonRow('year', t('connectPage.fitness.yearToDate'), data.seasonYear),
      ]}
      rowKey={(row) => row.id}
    />
  );
}

/** The activity a click opened, read from what the screen already holds. */
function OpenedDetail({ dot, onClose }: { dot: Dot | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  if (!dot) return null;
  return (
    <section
      id="detail-pane"
      className="panel"
      aria-label={t('connectPage.fitness.openedActivity')}
    >
      <h3>{dot.name}</h3>
      <dl>
        <dt>{t('connectPage.fitness.sport')}</dt>
        <dd>{dot.sportType}</dd>
        <dt>{t('connectPage.fitness.started')}</dt>
        <dd>{dot.startDateLocal.replace('T', ' ')}</dd>
        <dt>{t('connectPage.facts.time')}</dt>
        <dd>{clock(dot.movingTime)}</dd>
        <dt>{t('connectPage.facts.distance')}</dt>
        <dd>{km(dot.distance)}</dd>
        <dt>{t('connectPage.fitness.colLoad')}</dt>
        <dd>{Math.round(dot.load)}</dd>
      </dl>
      <a href={`#/activity/${encodeURIComponent(dot.activityId)}`}>
        {t('connectPage.fitness.openActivityPage')}
      </a>{' '}
      <Button onClick={onClose}>{t('connectPage.fitness.close')}</Button>
    </section>
  );
}

export function FitnessPane({
  panels,
  bestEffortDays,
  route,
  choices,
  onChoose,
  onBestPeriod,
}: {
  panels: Panels;
  bestEffortDays: number;
  route: Route;
  choices: FitnessChoices;
  onChoose: (choices: FitnessChoices) => void;
  onBestPeriod: (days: number) => void;
}) {
  const { t } = useTranslation();
  const held = panels.screen?.data as Screen | undefined;
  const open = held?.loadDots.find((dot) => dot.activityId === choices.open);
  const power = choices.sport === 'Ride';
  const openActivity = (id: string) => onChoose({ ...choices, open: id });
  const card = (title: ReactNode, body: ReactNode, wide = false) => (
    <div className={wide ? 'cell wide' : 'cell'}>
      <Card>
        <CardHeader title={String(title)} />
        {body}
      </Card>
    </div>
  );
  const comparisons = card(
    t('connectPage.fitness.weekAndSeason'),
    <Slot<Screen>
      slot="screen"
      part="comparisons"
      panels={panels}
      draw={(data) => <Comparisons data={data} />}
    />,
    true
  );
  const overview = (
    <>
      <Slot<Wellness> slot="wellness" panels={panels} draw={(data) => <Tiles data={data} />} />
      <div className="dashboard">
        {card(
          t('connectPage.fitness.fitnessFatigue'),
          <Slot<Wellness>
            slot="wellness"
            part="chart"
            panels={panels}
            draw={(data) => <WellnessPanel data={data} />}
          />,
          true
        )}
        {card(
          t('connectPage.fitness.wellnessLanes'),
          <Slot<Wellness>
            slot="wellness"
            part="lanes"
            panels={panels}
            draw={(data) => <WellnessLanes data={data} />}
          />,
          true
        )}
        {card(
          t('connectPage.fitness.activitiesByLoad'),
          <Slot<Screen>
            slot="screen"
            part="dots"
            panels={panels}
            draw={(data) => (
              <LoadDots dots={data.loadDots} open={choices.open} onOpen={openActivity} />
            )}
          />,
          true
        )}
        {open ? (
          <div className="cell">
            <OpenedDetail dot={open} onClose={() => onChoose({ ...choices, open: null })} />
          </div>
        ) : null}
      </div>
    </>
  );
  const calendar = (
    <div className="dashboard">
      {card(
        t('connectPage.fitness.calendar'),
        <Slot<Screen>
          slot="screen"
          part="calendar"
          panels={panels}
          draw={(data) => (
            <Calendar days={data.heatmap} dots={data.loadDots} onOpen={openActivity} />
          )}
        />,
        true
      )}
      {comparisons}
      {card(
        t('connectPage.fitness.months'),
        <Slot<Screen>
          slot="screen"
          part="months"
          panels={panels}
          draw={(data) => <MonthsTable months={data.months} route={route} onRoute={go} />}
        />
      )}
    </div>
  );
  const performance = (
    <div className="dashboard">
      {power
        ? card(
            t('connectPage.fitness.powerCurve'),
            <Slot<PowerCurve>
              slot="powerCurve"
              panels={panels}
              draw={(data) => <PowerCurvePanel data={data} />}
            />,
            true
          )
        : card(
            t('connectPage.fitness.paceCurve'),
            <Slot<PaceCurve>
              slot="paceCurve"
              panels={panels}
              draw={(data) => <PaceCurvePanel data={data} />}
            />,
            true
          )}
      <div className="cell wide">
        <Card>
          <CardHeader
            title={t('connectPage.fitness.bestEfforts')}
            actions={
              <Choices
                id="best-period"
                label={t('connectPage.fitness.period')}
                values={BEST_EFFORT_PERIODS}
                current={bestEffortDays}
                name={(n: number) =>
                  n ? t('connectPage.fitness.days', { count: n }) : t('connectPage.fitness.allTime')
                }
                pick={onBestPeriod}
              />
            }
          />
          <Slot<BestEfforts>
            slot="bestEfforts"
            panels={panels}
            draw={(data) => <BestEffortsPanel data={data} route={route} onRoute={go} />}
          />
        </Card>
      </div>
    </div>
  );
  const trends = (
    <div className="dashboard">
      {card(
        power ? t('connectPage.fitness.powerZones') : t('connectPage.fitness.heartRateZones'),
        <Slot<Zones> slot="zones" panels={panels} draw={(data) => <ZonesPanel data={data} />} />
      )}
      {card(
        t('connectPage.fitness.thresholds'),
        <Slot<Screen>
          slot="screen"
          panels={panels}
          draw={(data) => <ThresholdsPanel data={data} />}
        />
      )}
      {card(
        t('connectPage.fitness.estimatedFtp'),
        <Slot<Screen>
          slot="screen"
          part="eftp"
          panels={panels}
          draw={(data) => <EftpPanel data={data} />}
        />,
        true
      )}
      {card(
        t('connectPage.fitness.decoupling'),
        <Slot<Screen>
          slot="screen"
          part="decoupling"
          panels={panels}
          draw={(data) => <DecouplingPanel data={data} />}
        />
      )}
      {card(
        t('connectPage.fitness.hoursPerWeek'),
        <Slot<Screen>
          slot="screen"
          part="hours"
          panels={panels}
          draw={(data) => <WeeklyHours weeks={data.weeklyHours} />}
        />
      )}
      {card(
        t('connectPage.fitness.dailyLoad'),
        <Slot<Loads> slot="loads" panels={panels} draw={(data) => <LoadsPanel data={data} />} />
      )}
    </div>
  );
  return (
    <section id="fitness-page">
      <div className="toolbar">
        <Choices
          id="range"
          label={t('connectPage.fitness.range')}
          values={RANGES}
          current={choices.range}
          name={(n: number) => t('connectPage.fitness.days', { count: n })}
          pick={(n: number) => onChoose({ ...choices, range: n })}
        />
        <Choices
          id="sport"
          label={t('connectPage.fitness.sport')}
          values={FITNESS_SPORTS}
          current={choices.sport}
          name={(n: FitnessChoices['sport']) => t(`activityTypes.${n}`)}
          pick={(n: string) => onChoose({ ...choices, sport: n as FitnessChoices['sport'] })}
        />
      </div>
      <Tabs
        label={t('connectPage.screens.fitness')}
        items={[
          { id: 'overview', label: t('connectPage.fitness.tabOverview'), panel: overview },
          { id: 'calendar', label: t('connectPage.fitness.tabCalendar'), panel: calendar },
          { id: 'performance', label: t('connectPage.fitness.tabPerformance'), panel: performance },
          { id: 'trends', label: t('connectPage.fitness.tabTrends'), panel: trends },
        ]}
      />
    </section>
  );
}
