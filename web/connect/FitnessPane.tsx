// The fitness page, drawn from the engine's numbers. Charts are SVG in the
// page's colour variables, each with a readout that follows the pointer.

import type { ParseKeys } from 'i18next';
import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
function LineChart({
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

const clock = (seconds: number) =>
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
  panels,
  draw,
}: {
  slot: string;
  panels: Snapshot['fitness'];
  draw: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const held = panels[slot];
  return (
    <div id={`panel-${slot}`}>
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
  values: readonly number[];
  current: number;
  name: (n: number) => string;
  pick: (n: number) => void;
}) {
  return (
    <div id={id} role="group" aria-label={label}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === current}
          onClick={() => pick(value)}
        >
          {name(value)}
        </button>
      ))}
    </div>
  );
}

export function FitnessPane({
  snapshot,
  onRange,
  onBestPeriod,
}: {
  snapshot: Snapshot;
  onRange: (days: number) => void;
  onBestPeriod: (days: number) => void;
}) {
  const { t } = useTranslation();
  const panels = snapshot.fitness;
  return (
    <section id="fitness-page">
      <div className="toolbar">
        <h2>{t('connectPage.screens.fitness')}</h2>
        <Choices
          id="range"
          label={t('connectPage.fitness.range')}
          values={RANGES}
          current={snapshot.fitnessRange}
          name={(n) => t('connectPage.fitness.days', { count: n })}
          pick={onRange}
        />
      </div>
      <div className="grid">
        <section className="panel">
          <h3>{t('connectPage.fitness.thresholds')}</h3>
          <Slot<Screen>
            slot="screen"
            panels={panels}
            draw={(data) => <ThresholdsPanel data={data} />}
          />
        </section>
        <section className="panel wide">
          <h3>{t('connectPage.fitness.fitnessFatigue')}</h3>
          <Slot<Wellness>
            slot="wellness"
            panels={panels}
            draw={(data) => <WellnessPanel data={data} />}
          />
        </section>
        <section className="panel">
          <h3>{t('connectPage.fitness.dailyLoad')}</h3>
          <Slot<Loads> slot="loads" panels={panels} draw={(data) => <LoadsPanel data={data} />} />
        </section>
        <section className="panel">
          <h3>{t('connectPage.fitness.powerZones')}</h3>
          <Slot<Zones> slot="zones" panels={panels} draw={(data) => <ZonesPanel data={data} />} />
        </section>
        <section className="panel">
          <h3>{t('connectPage.fitness.powerCurve')}</h3>
          <Slot<PowerCurve>
            slot="powerCurve"
            panels={panels}
            draw={(data) => <PowerCurvePanel data={data} />}
          />
        </section>
        <section className="panel">
          <h3>{t('connectPage.fitness.paceCurve')}</h3>
          <Slot<PaceCurve>
            slot="paceCurve"
            panels={panels}
            draw={(data) => <PaceCurvePanel data={data} />}
          />
        </section>
      </div>
      <div className="toolbar">
        <h2>{t('connectPage.fitness.bestEfforts')}</h2>
        <Choices
          id="best-period"
          label={t('connectPage.fitness.period')}
          values={BEST_EFFORT_PERIODS}
          current={snapshot.bestEffortDays}
          name={(n) =>
            n ? t('connectPage.fitness.days', { count: n }) : t('connectPage.fitness.allTime')
          }
          pick={onBestPeriod}
        />
      </div>
      <section className="panel">
        <Slot<BestEfforts>
          slot="bestEfforts"
          panels={panels}
          draw={(data) => <BestEffortsPanel data={data} />}
        />
      </section>
    </section>
  );
}
