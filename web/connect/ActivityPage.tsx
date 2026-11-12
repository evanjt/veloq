// The activity page at `#/activity/<id>`: a map slot two thirds wide with the
// charts under it on one shared axis, and the facts in a right column that
// scrolls on its own. The page holds what it is given and asks nothing.

import { Fragment, useId, useRef, useState } from 'react';

import {
  crosshair,
  indexAtX,
  linePath,
  seriesRange,
  xOf,
  type Axis,
  type ChartData,
} from './chart';
import { clock, km, kmh } from './format';
import type { Card, Detail } from './session';

/** A row in the right column that opens another page. */
export type LinkedRow = { id: string; name: string; detail?: string };

/** What the right column shows beyond the summary strip; a missing part is left out. */
export type Facts = {
  sections?: (LinkedRow & { portion?: { from: number; to: number } })[];
  routes?: LinkedRow[];
  intervals?: { name: string; time: string; distance: string }[];
  zones?: { label: string; rows: { name: string; share: number }[] }[];
  notes?: { label: string; value: string }[];
};

/** Where the pointer rests on the chart, shared with the map slot. */
export type Position = { index: number; time: number; distance: number };

const WIDTH = 720;
const HEIGHT = 200;

const SERIES_LABELS: Record<string, [label: string, unit: string]> = {
  altitude: ['Elevation', 'm'],
  heartrate: ['Heart rate', 'bpm'],
  watts: ['Power', 'W'],
  cadence: ['Cadence', 'rpm'],
  velocity: ['Speed', 'm/s'],
  grade: ['Grade', '%'],
  temp: ['Temperature', '°C'],
};

const label = (key: string) => SERIES_LABELS[key]?.[0] ?? key;
const unit = (key: string) => SERIES_LABELS[key]?.[1] ?? '';

export function ActivityPage(props: {
  id: string;
  card: Card | undefined;
  detail: Detail | undefined;
  data: ChartData | null;
  facts?: Facts;
  /** Told where the crosshair is, or null when it leaves, so the map can mark it. */
  onPosition?: (position: Position | null) => void;
}) {
  const { card, detail } = props;
  const [position, setPosition] = useState<Position | null>(null);
  const publish = (next: Position | null) => {
    setPosition(next);
    props.onPosition?.(next);
  };
  return (
    <section id="activity-page">
      <header id="activity-head">
        <a id="back" href="#/feed">
          Back to the feed
        </a>
        <h2 id="activity-title">{card?.name ?? 'Activity'}</h2>
        <p id="activity-when">
          {[card?.startDateLocal?.slice(0, 10), card?.sportType].filter(Boolean).join(' · ')}
        </p>
      </header>
      <div id="activity-left">
        <div id="map-slot" role="region" aria-label="Map" />
        <Charts data={props.data} position={position} onPosition={publish} />
      </div>
      <aside id="activity-right" aria-label="Activity facts">
        <SummaryStrip card={card} detail={detail} />
        <FactsColumn facts={props.facts ?? {}} position={position} />
      </aside>
    </section>
  );
}

function Charts(props: {
  data: ChartData | null;
  position: Position | null;
  onPosition: (position: Position | null) => void;
}) {
  const { data } = props;
  const keys = data ? Object.keys(data.series).filter((key) => seriesRange(data, key)) : [];
  const [axis, setAxis] = useState<Axis>('distance');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const plot = useRef<SVGSVGElement>(null);
  const titleId = useId();
  if (!data || data.time.length === 0) {
    return (
      <section id="charts" aria-labelledby={titleId}>
        <h3 id={titleId}>Charts</h3>
        <p>This activity has no recorded series.</p>
      </section>
    );
  }
  const visible = keys.filter((key) => !hidden.has(key));
  const reading = props.position ? crosshair(data, visible, props.position.index) : null;
  const move = (index: number | null) => {
    const at = index === null ? null : crosshair(data, [], index);
    props.onPosition(at ? { index: at.index, time: at.time, distance: at.distance } : null);
  };
  const pointer = (clientX: number) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    move(indexAtX(data, axis, ((clientX - box.left) / box.width) * WIDTH, WIDTH));
  };
  const step = (by: number) => {
    const last = data.time.length - 1;
    move(Math.min(last, Math.max(0, (props.position?.index ?? 0) + by)));
  };
  return (
    <section id="charts" aria-labelledby={titleId}>
      <h3 id={titleId}>Charts</h3>
      <div id="series-chips" role="group" aria-label="Series">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={!hidden.has(key)}
            onClick={() => {
              const next = new Set(hidden);
              if (!next.delete(key)) next.add(key);
              setHidden(next);
            }}
          >
            {label(key)}
          </button>
        ))}
      </div>
      <div id="axis-switch" role="group" aria-label="Axis">
        {(['distance', 'time'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={axis === choice}
            onClick={() => setAxis(choice)}
          >
            {choice === 'distance' ? 'Distance' : 'Time'}
          </button>
        ))}
      </div>
      <svg
        id="chart"
        ref={plot}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        tabIndex={0}
        aria-label="Activity series"
        onPointerMove={(event) => pointer(event.clientX)}
        onPointerLeave={() => move(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') step(1);
          else if (event.key === 'ArrowLeft') step(-1);
          else return;
          event.preventDefault();
        }}
      >
        {visible.map((key, at) => (
          <path
            key={key}
            className={`line line-${at % 6}`}
            fill="none"
            strokeLinecap="round"
            d={linePath(data, axis, key, WIDTH, HEIGHT)}
          />
        ))}
        {props.position ? (
          <line
            id="crosshair"
            y1={0}
            y2={HEIGHT}
            x1={xOf(data, axis, props.position.index, WIDTH)}
            x2={xOf(data, axis, props.position.index, WIDTH)}
          />
        ) : null}
      </svg>
      {reading ? (
        <dl id="crosshair-reading">
          <dt>{axis === 'distance' ? 'Distance' : 'Time'}</dt>
          <dd>{axis === 'distance' ? km(reading.distance) : clock(reading.time)}</dd>
          {reading.values.map(({ key, value }) => (
            <Fragment key={key}>
              <dt>{label(key)}</dt>
              <dd>{`${Math.round(value * 10) / 10} ${unit(key)}`.trim()}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function SummaryStrip({ card, detail }: { card: Card | undefined; detail: Detail | undefined }) {
  const facts: [string, string | null][] =
    card && detail
      ? [
          ['Distance', km(card.distance)],
          ['Moving time', clock(detail.movingTime)],
          ['Elapsed time', clock(detail.elapsedTime)],
          ['Average speed', kmh(detail.averageSpeed)],
          ['Top speed', kmh(detail.maxSpeed)],
          ['Climbing', card.elevationGain == null ? null : `${Math.round(card.elevationGain)} m`],
          ['Average heart rate', card.avgHr == null ? null : `${Math.round(card.avgHr)} bpm`],
          ['Average power', card.avgPower == null ? null : `${Math.round(card.avgPower)} W`],
        ]
      : [];
  return (
    <section id="activity-summary">
      <h3>Summary</h3>
      <dl>
        {facts
          .filter(([, value]) => value)
          .map(([name, value]) => (
            <Fragment key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
      </dl>
    </section>
  );
}

function FactsColumn({ facts, position }: { facts: Facts; position: Position | null }) {
  const [lit, setLit] = useState<string | null>(null);
  return (
    <>
      {facts.sections?.length ? (
        <section id="activity-sections">
          <h3>Sections</h3>
          <ul>
            {facts.sections.map((row) => (
              <li
                key={row.id}
                data-lit={lit === row.id}
                onPointerEnter={() => setLit(row.id)}
                onPointerLeave={() => setLit(null)}
              >
                <a href={`#/section/${encodeURIComponent(row.id)}`}>{row.name}</a>
                {row.detail ? <span>{row.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {facts.routes?.length ? (
        <section id="activity-routes">
          <h3>Routes</h3>
          <ul>
            {facts.routes.map((row) => (
              <li key={row.id}>
                <a href={`#/route/${encodeURIComponent(row.id)}`}>{row.name}</a>
                {row.detail ? <span>{row.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {facts.intervals?.length ? (
        <section id="activity-intervals">
          <h3>Intervals</h3>
          <table>
            <tbody>
              {facts.intervals.map((row, at) => (
                <tr key={at}>
                  <th scope="row">{row.name}</th>
                  <td>{row.time}</td>
                  <td>{row.distance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {facts.zones?.map((zone) => (
        <section key={zone.label} className="zones">
          <h3>{zone.label}</h3>
          <dl>
            {zone.rows.map((row) => (
              <Fragment key={row.name}>
                <dt>{row.name}</dt>
                <dd>{`${Math.round(row.share * 100)} %`}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
      {facts.notes?.length ? (
        <section id="activity-notes">
          <dl>
            {facts.notes.map((note) => (
              <Fragment key={note.label}>
                <dt>{note.label}</dt>
                <dd>{note.value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ) : null}
      <span hidden data-position={position?.index ?? ''} data-lit-section={lit ?? ''} />
    </>
  );
}
