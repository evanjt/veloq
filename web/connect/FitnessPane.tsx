// The fitness page, drawn from the engine's numbers. Charts are SVG in the
// page's colour variables, each with a readout that follows the pointer.

import type { ParseKeys } from 'i18next';
import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FITNESS_SPORTS,
  calendarYears,
  dotsOnDay,
  monthRows,
  sortMonths,
  type FitnessChoices,
  type MonthColumn,
} from './dashboard';
import { BEST_EFFORT_PERIODS, RANGES, fraction, linePath } from './fitness';
import type { Methods } from './schema';
import type { Snapshot } from './session';

type Wellness = Methods['fitness.wellness']['result'];
type Loads = Methods['fitness.loads']['result'];
type Zones = Methods['fitness.zones']['result'];
type PowerCurve = Methods['fitness.powerCurve']['result'];
type PaceCurve = Methods['fitness.paceCurve']['result'];
type Screen = Methods['fitness.screen']['result'];
type BestEfforts = Methods['fitness.bestEfforts']['result'];

const WIDTH = 640;
const HEIGHT = 200;
const PAD = 8;

type Line = { className: string; values: (number | null)[] };

/**
 * A line chart over shared categories with a hover readout. `labels` are the
 * readout's heading for each position, and `format` writes one value.
 */
export function LineChart({
  labels,
  lines,
  names,
  format,
}: {
  labels: string[];
  lines: Line[];
  names: string[];
  format: (value: number) => string;
}) {
  const { t } = useTranslation();
  const [at, setAt] = useState<number | null>(null);
  const present = lines.flatMap((line) => line.values.filter((v): v is number => v !== null));
  if (labels.length === 0 || present.length === 0) {
    return (
      <figure>
        <p className="empty">{t('connectPage.fitness.noData')}</p>
      </figure>
    );
  }
  const low = Math.min(...present);
  const high = Math.max(...present);
  const x = (i: number) => PAD + fraction(i, 0, Math.max(labels.length - 1, 1)) * (WIDTH - PAD * 2);
  const y = (v: number) => HEIGHT - PAD - fraction(v, low, high) * (HEIGHT - PAD * 2);
  const readout =
    at === null
      ? ' '
      : [
          labels[at],
          ...lines.map((line, n) => {
            const v = line.values[at];
            return `${names[n]} ${v === null || v === undefined ? t('connectPage.fitness.none') : format(v)}`;
          }),
        ].join(' · ');
  return (
    <figure>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const near = Math.round(
            fraction((event.clientX - box.left) / box.width, PAD / WIDTH, 1 - PAD / WIDTH) *
              (labels.length - 1)
          );
          setAt(Math.min(Math.max(near, 0), labels.length - 1));
        }}
      >
        {lines.map((line) => (
          <path
            key={line.className}
            d={linePath(line.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const))))}
            className={line.className}
            fill="none"
          />
        ))}
      </svg>
      <p className="readout">{readout}</p>
    </figure>
  );
}

const COVERAGE_NOTES: Record<Wellness['coverage'], ParseKeys | null> = {
  loaded: null,
  empty: 'connectPage.fitness.noWellness',
  notFetched: 'connectPage.fitness.wellnessNotFetched',
};

function WellnessPanel({ data }: { data: Wellness }) {
  const { t } = useTranslation();
  const note = COVERAGE_NOTES[data.coverage];
  return (
    <>
      <LineChart
        labels={data.days.map((day) => day.date)}
        lines={[
          { className: 'line-a', values: data.days.map((day) => day.ctl) },
          { className: 'line-b', values: data.days.map((day) => day.atl) },
        ]}
        names={[t('connectPage.facts.fitness'), t('connectPage.fitness.fatigue')]}
        format={(value) => value.toFixed(1)}
      />
      {note ? <p className="empty">{t(note)}</p> : null}
    </>
  );
}

const sumOf = (values: (number | null)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0);

function LoadsPanel({ data }: { data: Loads }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...data.days.map((day) => day.total ?? 0));
  return (
    <>
      {data.days.length ? (
        <ol className="bars">
          {data.days.map((day) => (
            <li
              key={day.date}
              title={t('connectPage.fitness.loadReadout', {
                date: day.date,
                load: day.total === null ? t('connectPage.fitness.none') : Math.round(day.total),
              })}
            >
              <span style={{ height: `${Math.round(fraction(day.total ?? 0, 0, max) * 100)}%` }} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">{t('connectPage.fitness.noActivities')}</p>
      )}
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
  if (data.seconds.length === 0) return <p className="empty">{t('connectPage.fitness.noZones')}</p>;
  return (
    <ol className="zones">
      {data.seconds.map((seconds, i) => (
        <li key={i}>
          <span className="name">
            {data.names[i] ?? t('connectPage.fitness.zone', { n: i + 1 })}
          </span>
          <span style={{ width: `${data.shares[i] ?? 0}%` }} />
          <span className="value">{`${data.shares[i] ?? 0}% · ${(seconds / 3600).toFixed(1)} h`}</span>
        </li>
      ))}
    </ol>
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
    <LineChart
      labels={curve.secs.map(clock)}
      lines={[{ className: 'line-a', values: curve.watts }]}
      names={[t('connectPage.chart.power')]}
      format={(value) => `${Math.round(value)} W`}
    />
  );
}

function PaceCurvePanel({ data }: { data: PaceCurve }) {
  const { t } = useTranslation();
  const curve = data.curve;
  if (!curve) return <NotDownloaded />;
  return (
    <LineChart
      labels={curve.distances.map((metres) =>
        metres >= 1000 ? `${metres / 1000} km` : `${metres} m`
      )}
      lines={[{ className: 'line-a', values: curve.times }]}
      names={[t('connectPage.facts.time')]}
      format={clock}
    />
  );
}

const EFFORT_HEADS: ParseKeys[] = [
  'connectPage.fitness.effortSport',
  'connectPage.fitness.effortEffort',
  'connectPage.fitness.effortBest',
  'connectPage.fitness.effortActivity',
];

function BestEffortsPanel({ data }: { data: BestEfforts }) {
  const { t } = useTranslation();
  return (
    <table>
      <thead>
        <tr>
          {EFFORT_HEADS.map((title) => (
            <th key={title}>{t(title)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.sports.map((sport) =>
          !sport.fetched ? (
            <tr key={sport.sport}>
              <td>{sport.sport}</td>
              <td colSpan={3}>{t('connectPage.fitness.effortsMissing')}</td>
            </tr>
          ) : (
            sport.efforts.map((effort, at) => (
              <tr key={`${sport.sport}-${at}`}>
                <td>{sport.sport}</td>
                <td>
                  {effort.kind === 'duration'
                    ? clock(effort.checkpoint)
                    : `${effort.checkpoint / 1000} km`}
                </td>
                <td>
                  {sport.sport === 'Ride'
                    ? effort.value === null
                      ? ''
                      : `${Math.round(effort.value)} W`
                    : effort.time === null
                      ? ''
                      : clock(effort.time)}
                </td>
                <td>{effort.activity?.name ?? effort.activityId ?? ''}</td>
              </tr>
            ))
          )
        )}
      </tbody>
    </table>
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

/** One panel's slot: its drawing once the phone answers, a notice if it could not. */
function Slot<T>({
  slot,
  part,
  panels,
  draw,
}: {
  slot: string;
  /** Names the drawing when one read feeds several panels. */
  part?: string;
  panels: Snapshot['fitness'];
  draw: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const held = panels[slot];
  return (
    <div id={`panel-${slot}${part ? `-${part}` : ''}`}>
      {held === undefined
        ? null
        : held === 'failed'
          ? t('connectPage.fitness.failed')
          : draw(held.answer as T)}
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
    <div id={id} role="group" aria-label={label}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === current}
          onClick={() => pick(value as never)}
        >
          {name(value as never)}
        </button>
      ))}
    </div>
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
  const [at, setAt] = useState<Dot | null>(null);
  if (dots.length === 0) return <p className="empty">{t('connectPage.fitness.noActivitiesSpan')}</p>;
  const times = dots.map((dot) => Date.parse(dot.startDateLocal));
  const first = Math.min(...times);
  const last = Math.max(...times);
  const top = Math.max(1, ...dots.map((dot) => dot.load));
  return (
    <figure>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('connectPage.fitness.activitiesByLoad')}>
        {dots.map((dot, i) => (
          <circle
            key={dot.activityId}
            className={dot.activityId === open ? 'dot open' : 'dot'}
            cx={PAD + fraction(times[i] ?? 0, first, last) * (WIDTH - PAD * 2)}
            cy={HEIGHT - PAD - fraction(dot.load, 0, top) * (HEIGHT - PAD * 2)}
            r={5}
            onPointerEnter={() => setAt(dot)}
            onClick={() => onOpen(dot.activityId)}
          />
        ))}
      </svg>
      <p className="readout">
        {at
          ? t('connectPage.fitness.dotReadout', {
              date: at.startDateLocal.slice(0, 10),
              name: at.name,
              load: Math.round(at.load),
            })
          : ' '}
      </p>
    </figure>
  );
}

/** The heatmap days as a row of weeks per year; a click opens that day's activity. */
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
  const [at, setAt] = useState('');
  const years = calendarYears(days, 1);
  if (years.length === 0) return <p className="empty">{t('connectPage.fitness.noCalendarDays')}</p>;
  const dayText = (cell: { date: string; activityCount: number }) =>
    t('connectPage.fitness.dayActivities', { date: cell.date, count: cell.activityCount });
  return (
    <div className="calendar">
      {years.map((year) => (
        <div key={year.year} className="year">
          <h4>{year.year}</h4>
          <div className="weeks">
            {year.weeks.map((week, w) => (
              <div key={w} className="week">
                {week.map((cell, d) =>
                  cell === null ? (
                    <span key={d} className="day none" />
                  ) : (
                    <button
                      key={d}
                      type="button"
                      className={`day level-${cell.intensity}`}
                      title={dayText(cell)}
                      onPointerEnter={() => setAt(dayText(cell))}
                      onClick={() => {
                        const [first] = dotsOnDay(dots, cell.date);
                        if (first) onOpen(first);
                      }}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="readout">{at || ' '}</p>
    </div>
  );
}

const km = (metres: number) => `${(metres / 1000).toFixed(0)} km`;

function MonthsTable({ months }: { months: Screen['months'] }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ column: MonthColumn; direction: 'asc' | 'desc' } | null>(null);
  const rows = monthRows(months);
  const shown = sort ? sortMonths(rows, sort.column, sort.direction) : [...rows].reverse();
  const columns: [MonthColumn, string][] = [
    ['count', t('connectPage.fitness.colActivities')],
    ['duration', t('connectPage.facts.time')],
    ['distance', t('connectPage.facts.distance')],
    ['load', t('connectPage.fitness.colLoad')],
  ];
  return (
    <table id="months">
      <thead>
        <tr>
          <th>{t('connectPage.fitness.colMonth')}</th>
          {columns.map(([column, title]) => (
            <th key={column}>
              <button
                type="button"
                aria-sort={
                  sort?.column === column
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
                onClick={() =>
                  setSort({
                    column,
                    direction:
                      sort?.column === column && sort.direction === 'desc' ? 'asc' : 'desc',
                  })
                }
              >
                {title}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => (
          <tr key={row.key}>
            <td>{row.key}</td>
            <td>{row.count ?? ''}</td>
            <td>{row.duration == null ? '' : clock(row.duration)}</td>
            <td>{row.distance == null ? '' : km(row.distance)}</td>
            <td>{row.load == null ? '' : Math.round(row.load)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Comparison = Screen['seasonYear'];

function ComparisonRow({ label, data }: { label: string; data: Comparison }) {
  const now = data.currentStats;
  const before = data.previousStats;
  return (
    <tr>
      <td>{label}</td>
      <td>{`${now.count} (${before.count})`}</td>
      <td>{`${clock(now.totalDuration)} (${clock(before.totalDuration)})`}</td>
      <td>{`${km(now.totalDistance)} (${km(before.totalDistance)})`}</td>
      <td>{`${Math.round(now.totalTss)} (${Math.round(before.totalTss)})`}</td>
    </tr>
  );
}

function Comparisons({ data }: { data: Screen }) {
  const { t } = useTranslation();
  const titles = [
    t('connectPage.fitness.period'),
    t('connectPage.fitness.colActivities'),
    t('connectPage.facts.time'),
    t('connectPage.facts.distance'),
    t('connectPage.fitness.colLoad'),
  ];
  return (
    <table id="comparisons">
      <thead>
        <tr>
          {titles.map((title) => (
            <th key={title}>{title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <ComparisonRow label={t('connectPage.facts.thisWeek')} data={data.comparisons.week} />
        <ComparisonRow label={t('connectPage.fitness.yearToDate')} data={data.seasonYear} />
      </tbody>
    </table>
  );
}

/** The activity a click opened, read from what the screen already holds. */
function OpenedDetail({ dot, onClose }: { dot: Dot | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  if (!dot) return null;
  return (
    <section id="detail-pane" className="panel" aria-label={t('connectPage.fitness.openedActivity')}>
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
      <button type="button" onClick={onClose}>
        {t('connectPage.fitness.close')}
      </button>
    </section>
  );
}

export function FitnessPane({
  snapshot,
  choices,
  onChoose,
  onBestPeriod,
}: {
  snapshot: Snapshot;
  choices: FitnessChoices;
  onChoose: (choices: FitnessChoices) => void;
  onBestPeriod: (days: number) => void;
}) {
  const { t } = useTranslation();
  const panels = snapshot.fitness;
  const screen = panels.screen;
  const held = screen && screen !== 'failed' ? (screen.answer as Screen) : undefined;
  const open = held?.loadDots.find((dot) => dot.activityId === choices.open);
  const power = choices.sport === 'Ride';
  const openActivity = (id: string) => onChoose({ ...choices, open: id });
  return (
    <section id="fitness-page">
      <div className="toolbar">
        <h2>{t('connectPage.screens.fitness')}</h2>
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
      <div className="columns">
        <div className="column charts">
          <section className="panel">
            <h3>{t('connectPage.fitness.fitnessFatigue')}</h3>
            <Slot<Wellness>
              slot="wellness"
              panels={panels}
              draw={(data) => <WellnessPanel data={data} />}
            />
          </section>
          <section className="panel">
            <h3>{t('connectPage.fitness.activitiesByLoad')}</h3>
            <Slot<Screen>
              slot="screen"
              part="dots"
              panels={panels}
              draw={(data) => (
                <LoadDots dots={data.loadDots} open={choices.open} onOpen={openActivity} />
              )}
            />
          </section>
          <section className="panel">
            <h3>{t('connectPage.fitness.dailyLoad')}</h3>
            <Slot<Loads> slot="loads" panels={panels} draw={(data) => <LoadsPanel data={data} />} />
          </section>
          <section className="panel">
            <h3>
              {power
                ? t('connectPage.fitness.powerZones')
                : t('connectPage.fitness.heartRateZones')}
            </h3>
            <Slot<Zones> slot="zones" panels={panels} draw={(data) => <ZonesPanel data={data} />} />
          </section>
          {power ? (
            <section className="panel">
              <h3>{t('connectPage.fitness.powerCurve')}</h3>
              <Slot<PowerCurve>
                slot="powerCurve"
                panels={panels}
                draw={(data) => <PowerCurvePanel data={data} />}
              />
            </section>
          ) : (
            <section className="panel">
              <h3>{t('connectPage.fitness.paceCurve')}</h3>
              <Slot<PaceCurve>
                slot="paceCurve"
                panels={panels}
                draw={(data) => <PaceCurvePanel data={data} />}
              />
            </section>
          )}
          <section className="panel">
            <h3>{t('connectPage.fitness.calendar')}</h3>
            <Slot<Screen>
              slot="screen"
              part="calendar"
              panels={panels}
              draw={(data) => (
                <Calendar days={data.heatmap} dots={data.loadDots} onOpen={openActivity} />
              )}
            />
          </section>
        </div>
        <div className="column tables">
          <OpenedDetail dot={open} onClose={() => onChoose({ ...choices, open: null })} />
          <section className="panel">
            <h3>{t('connectPage.fitness.thresholds')}</h3>
            <Slot<Screen>
              slot="screen"
              panels={panels}
              draw={(data) => <ThresholdsPanel data={data} />}
            />
          </section>
          <section className="panel">
            <h3>{t('connectPage.fitness.weekAndSeason')}</h3>
            <Slot<Screen>
              slot="screen"
              part="comparisons"
              panels={panels}
              draw={(data) => <Comparisons data={data} />}
            />
          </section>
          <section className="panel">
            <h3>{t('connectPage.fitness.months')}</h3>
            <Slot<Screen>
              slot="screen"
              part="months"
              panels={panels}
              draw={(data) => <MonthsTable months={data.months} />}
            />
          </section>
          <section className="panel">
            <div className="toolbar">
              <h3>{t('connectPage.fitness.bestEfforts')}</h3>
              <Choices
                id="best-period"
                label={t('connectPage.fitness.period')}
                values={BEST_EFFORT_PERIODS}
                current={snapshot.bestEffortDays}
                name={(n: number) =>
                  n ? t('connectPage.fitness.days', { count: n }) : t('connectPage.fitness.allTime')
                }
                pick={onBestPeriod}
              />
            </div>
            <Slot<BestEfforts>
              slot="bestEfforts"
              panels={panels}
              draw={(data) => <BestEffortsPanel data={data} />}
            />
          </section>
        </div>
      </div>
    </section>
  );
}
