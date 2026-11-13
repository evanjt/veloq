// The activity page at `#/activity/<id>`, on the component and chart kits: a
// hero with the map slot beside the headline stat cards, the series in lanes
// that share one crosshair, then zones, laps and sections as dense tables. The
// page holds what it is given and asks nothing.

import type { ParseKeys } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, DataTable, type Column } from "./ui";
import { Chart, type Series } from "./charts/Chart";
import { crosshair, seriesRange, type ChartData } from "./chart";
import { portionHolds } from "./activity";
import { clock, km, kmh } from "./format";
import type { Card as FeedCard, Detail } from "./session";
import { ActivityMap } from "./map/ActivityMap";
import type { Ask } from "./map/protocol";

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

/** The most samples a lane draws; a longer ride is thinned evenly. */
const MAX_POINTS = 300;
/** The lanes in the order they stack, each with the series it draws. */
const LANES = [
  "altitude",
  "heartrate",
  "watts",
  "velocity",
  "cadence",
] as const;
const MAX_LANES = 3;

const SERIES_LABELS: Record<string, [label: ParseKeys, unit: string]> = {
  altitude: ["connectPage.chart.elevation", "m"],
  heartrate: ["connectPage.chart.heartRate", "bpm"],
  watts: ["connectPage.chart.power", "W"],
  cadence: ["connectPage.chart.cadence", "rpm"],
  velocity: ["connectPage.chart.speed", "km/h"],
  grade: ["connectPage.chart.grade", "%"],
  temp: ["connectPage.chart.temperature", "°C"],
};

/** The name of a series; a key the page has no name for is shown as it came. */
const labelOf = (t: (key: ParseKeys) => string, key: string) => {
  const found = SERIES_LABELS[key]?.[0];
  return found ? t(found) : key;
};
const unit = (key: string) => SERIES_LABELS[key]?.[1] ?? "";

export function ActivityPage(props: {
  id: string;
  card: FeedCard | undefined;
  detail: Detail | undefined;
  data: ChartData | null;
  facts?: Facts;
  /** Told where the crosshair is, or null when it leaves, so the map can mark it. */
  onPosition?: (position: Position | null) => void;
  /** How the map slot reaches the phone; without it the slot stays empty. */
  read?: Ask;
  /** Changes when the library does, so the map names its track by a new url. */
  revision?: number;
}) {
  const { card, detail } = props;
  const { t } = useTranslation();
  const [position, setPosition] = useState<Position | null>(null);
  const publish = (next: Position | null) => {
    setPosition(next);
    props.onPosition?.(next);
  };
  const facts = props.facts ?? {};
  const [litSection, setLitSection] = useState<string | null>(null);
  return (
    <section id="activity-page">
      <header id="activity-head">
        <a id="back" href="#/feed">
          {t("connectPage.activity.back")}
        </a>
        <h2 id="activity-title">
          {card?.name ?? t("connectPage.activity.untitled")}
        </h2>
        <p id="activity-when">
          {[card?.startDateLocal?.slice(0, 10), card?.sportType]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>
      <div id="activity-hero">
        <div
          id="map-slot"
          role="region"
          aria-label={t("connectPage.activity.map")}
        >
          {props.read ? (
            <ActivityMap
              id={props.id}
              revision={props.revision ?? 0}
              read={props.read}
              position={position}
              onPosition={publish}
              litSection={litSection}
              onLitSection={setLitSection}
              compare={[]}
            />
          ) : null}
        </div>
        <StatCards card={card} detail={detail} />
      </div>
      <Lanes data={props.data} position={position} onPosition={publish} />
      <div id="activity-tables">
        <Zones zones={facts.zones} />
        <Laps laps={facts.intervals} />
        <Sections
          sections={facts.sections}
          position={position}
          lit={litSection}
          onLit={setLitSection}
        />
        <Routes routes={facts.routes} />
        <Notes notes={facts.notes} />
      </div>
    </section>
  );
}

/** The samples a lane draws: every `stride`th one, so the index maps back to the ride. */
const strideOf = (count: number) => Math.max(1, Math.ceil(count / MAX_POINTS));

function Lanes(props: {
  data: ChartData | null;
  position: Position | null;
  onPosition: (position: Position | null) => void;
}) {
  const { data } = props;
  const { t } = useTranslation();
  const lanes = useMemo(
    () =>
      data
        ? LANES.filter((key) => seriesRange(data, key)).slice(0, MAX_LANES)
        : [],
    [data],
  );
  if (!data || data.time.length === 0 || lanes.length === 0) {
    return (
      <Card label={t("connectPage.activity.charts")}>
        <CardHeader title={t("connectPage.activity.charts")} />
        <p className="empty">{t("connectPage.activity.noSeries")}</p>
      </Card>
    );
  }
  const stride = strideOf(data.time.length);
  const picks = Array.from(
    { length: Math.ceil(data.time.length / stride) },
    (_, i) => i * stride,
  );
  const categories = picks.map((i) => km(data.distance[i] ?? 0) ?? "");
  const at = props.position ? Math.round(props.position.index / stride) : null;
  const onAt = (next: number | null) => {
    const sample = next === null ? null : crosshair(data, [], picks[next] ?? 0);
    props.onPosition(
      sample
        ? { index: sample.index, time: sample.time, distance: sample.distance }
        : null,
    );
  };
  const reading = props.position
    ? `${km(props.position.distance)} · ${clock(props.position.time)}`
    : null;
  return (
    <Card label={t("connectPage.activity.charts")}>
      <CardHeader
        title={t("connectPage.activity.charts")}
        actions={<span id="crosshair-reading">{reading}</span>}
      />
      <div id="activity-lanes">
        {lanes.map((key, n) => {
          const scale = key === "velocity" ? 3.6 : 1;
          const series: Series = {
            name: labelOf(t, key),
            colour: `var(--line-${n})`,
            values: picks.map((i) => {
              const value = data.series[key]?.[i];
              return value === undefined || !Number.isFinite(value)
                ? null
                : value * scale;
            }),
          };
          return (
            <Chart
              key={key}
              kind="line"
              categories={categories}
              series={[series]}
              format={(value) => `${Math.round(value * 10) / 10}`}
              yTitle={`${labelOf(t, key)} (${unit(key)})`}
              xTitle={t("connectPage.facts.distance")}
              label={labelOf(t, key)}
              empty={t("connectPage.activity.noSeries")}
              none="–"
              at={at}
              onAt={onAt}
            />
          );
        })}
      </div>
    </Card>
  );
}

function StatCards({
  card,
  detail,
}: {
  card: FeedCard | undefined;
  detail: Detail | undefined;
}) {
  const { t } = useTranslation();
  const stats: [string, string | null][] =
    card && detail
      ? [
          [t("connectPage.facts.distance"), km(card.distance)],
          [t("connectPage.facts.movingTime"), clock(detail.movingTime)],
          [t("connectPage.facts.elapsedTime"), clock(detail.elapsedTime)],
          [t("connectPage.facts.averageSpeed"), kmh(detail.averageSpeed)],
          [t("connectPage.facts.topSpeed"), kmh(detail.maxSpeed)],
          [
            t("connectPage.facts.climbing"),
            card.elevationGain == null
              ? null
              : `${Math.round(card.elevationGain)} m`,
          ],
          [
            t("connectPage.facts.averageHr"),
            card.avgHr == null ? null : `${Math.round(card.avgHr)} bpm`,
          ],
          [
            t("connectPage.facts.averagePower"),
            card.avgPower == null ? null : `${Math.round(card.avgPower)} W`,
          ],
        ]
      : [];
  return (
    <div
      id="activity-summary"
      role="group"
      aria-label={t("connectPage.activity.facts")}
    >
      {stats
        .filter(([, value]) => value)
        .map(([name, value]) => (
          <Card key={name}>
            <dl className="stat">
              <dt>{name}</dt>
              <dd>{value}</dd>
            </dl>
          </Card>
        ))}
    </div>
  );
}

function Zones({ zones }: { zones: Facts["zones"] }) {
  if (!zones?.length) return null;
  type Row = { name: string; share: number };
  const columns: Column<Row>[] = [
    { key: "name", header: "", cell: (row) => row.name },
    {
      key: "share",
      header: "%",
      numeric: true,
      cell: (row) => `${Math.round(row.share * 100)}`,
    },
  ];
  return (
    <>
      {zones.map((zone) => (
        <Card key={zone.label} label={zone.label}>
          <CardHeader title={zone.label} />
          <DataTable
            label={zone.label}
            columns={columns}
            rows={zone.rows}
            rowKey={(r) => r.name}
          />
        </Card>
      ))}
    </>
  );
}

function Laps({ laps }: { laps: Facts["intervals"] }) {
  const { t } = useTranslation();
  if (!laps?.length) return null;
  type Row = NonNullable<Facts["intervals"]>[number] & { key: string };
  const rows: Row[] = laps.map((lap, at) => ({ ...lap, key: String(at) }));
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("connectPage.activity.intervals"),
      cell: (row) => row.name,
    },
    {
      key: "time",
      header: t("connectPage.facts.time"),
      numeric: true,
      cell: (row) => row.time,
    },
    {
      key: "distance",
      header: t("connectPage.facts.distance"),
      numeric: true,
      cell: (row) => row.distance,
    },
  ];
  return (
    <Card label={t("connectPage.activity.intervals")}>
      <CardHeader title={t("connectPage.activity.intervals")} />
      <DataTable
        label={t("connectPage.activity.intervals")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
      />
    </Card>
  );
}

function Sections(props: {
  sections: Facts["sections"];
  position: Position | null;
  lit: string | null;
  onLit: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const { lit, onLit: setLit } = props;
  if (!props.sections?.length) return null;
  type Row = NonNullable<Facts["sections"]>[number];
  const held = props.sections.find((row) =>
    portionHolds(row.portion, props.position?.index ?? null),
  );
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("connectPage.activity.sections"),
      cell: (row) => (
        <a
          href={`#/section/${encodeURIComponent(row.id)}`}
          onPointerEnter={() => setLit(row.id)}
          onPointerLeave={() => setLit(null)}
        >
          {row.name}
        </a>
      ),
    },
    {
      key: "distance",
      header: t("connectPage.facts.distance"),
      numeric: true,
      cell: (row) => row.detail ?? "",
    },
  ];
  return (
    <Card label={t("connectPage.activity.sections")}>
      <CardHeader title={t("connectPage.activity.sections")} />
      <DataTable
        label={t("connectPage.activity.sections")}
        columns={columns}
        rows={props.sections}
        rowKey={(row) => row.id}
        selectedKey={lit ?? held?.id ?? null}
      />
    </Card>
  );
}

function Routes({ routes }: { routes: Facts["routes"] }) {
  const { t } = useTranslation();
  if (!routes?.length) return null;
  const columns: Column<LinkedRow>[] = [
    {
      key: "name",
      header: t("connectPage.activity.routes"),
      cell: (row) => (
        <a href={`#/route/${encodeURIComponent(row.id)}`}>{row.name}</a>
      ),
    },
    {
      key: "detail",
      header: "",
      numeric: true,
      cell: (row) => row.detail ?? "",
    },
  ];
  return (
    <Card label={t("connectPage.activity.routes")}>
      <CardHeader title={t("connectPage.activity.routes")} />
      <DataTable
        label={t("connectPage.activity.routes")}
        columns={columns}
        rows={routes}
        rowKey={(row) => row.id}
      />
    </Card>
  );
}

function Notes({ notes }: { notes: Facts["notes"] }) {
  if (!notes?.length) return null;
  const columns: Column<{ label: string; value: string }>[] = [
    { key: "label", header: "", cell: (row) => row.label },
    { key: "value", header: "", cell: (row) => row.value },
  ];
  return (
    <Card label={notes[0]?.label}>
      <DataTable
        label={notes[0]?.label ?? ""}
        columns={columns}
        rows={notes}
        rowKey={(r) => r.label}
      />
    </Card>
  );
}
