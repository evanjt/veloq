// The activity page at `#/activity/<id>`, on the component and chart kits: a
// hero with the map slot beside the headline stat cards, the series in lanes
// that share one crosshair, then zones, laps and sections as dense tables. The
// page holds what it is given and asks nothing.

import type { ParseKeys } from "i18next";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Card,
  CardHeader,
  Chip,
  ChipGroup,
  DataTable,
  DetailHeader,
  EmptyState,
  GridCell,
  LinkButton,
  ManagePanel,
  PageGrid,
  SegmentedControl,
  Skeleton,
  Tabs,
  type Column,
  type ManageGroup,
  type MenuItem,
} from "../ui";
import type {
  FfiActivityRecord,
  FfiExerciseSession,
  FfiPoolSwim,
  Methods,
} from "../schema";
import { Lanes, type LaneSeries } from "../charts/Lanes";
import { Sparkline } from "../charts/Sparkline";
import { streamColour } from "../charts/colours";
import type { IndexRange } from "../charts/scale";
import type { ChartStream } from "../theme";
import { crosshair, seriesRange, type ChartData } from "../chart";
import {
  DETAIL_STREAM_TYPES,
  chartDataOf,
  factsOfDetail,
  gpxOf,
  portionHolds,
  rangeReadout,
  rowsInRange,
  statGroups,
  type DetailData,
  type StatGroup,
  type StatGroupKey,
  type StatKey,
} from "../activity";
import { saveText } from "../download";
import { SportGlyph } from "../SportGlyph";
import { sportMark } from "../preview";
import { clock, distanceUnit, paceText, distanceValue, elapsed, km } from "../format";
import type { Detail } from "../feedReads";
import type { QueryClient, ReadError } from "../query";
import { ReadNotice } from "../shell/StatePanes";
import { useQueries, useRead, useReads } from "../useRead";
import { useEdit } from "../useEdit";
import { usePageName } from "../shell/pageName";
import type { PageProps } from "./types";
import { ActivityMap } from "../map/ActivityMap";
import { CreateSectionPanel } from "./CreateSection";
import {
  geoText,
  numberSections,
  trackPositions,
  type TrackColour,
} from "../map/activityLayers";

/** A row in the right column that opens another page. */
export type LinkedRow = { id: string; name: string; detail?: string };

/** What the right column shows beyond the summary strip; a missing part is left out. */
export type Facts = {
  sections?: (LinkedRow & { portion?: { from: number; to: number } })[];
  routes?: LinkedRow[];
  /** One row per pass over a section, in track order. */
  passes?: {
    key?: string;
    id: string;
    name: string;
    lapTime: string;
    rank: number | null;
    pr: boolean;
    /** The section's lap times in date order. */
    history: number[];
    /** The index in `history` of this pass. */
    current: number;
    /** The athlete left the activity out of this section: the row has no pass. */
    excluded?: boolean;
  }[];
  /** Every route and section the activity matched, and whether it is left out of each. */
  memberships?: { kind: "route" | "section"; id: string; name: string; excluded: boolean }[];
  /** Where the activity stands on each route it belongs to. */
  standing?: {
    id: string;
    name: string;
    rides: string;
    best: string;
    average: string;
    gap: string;
    bestActivityId: string | null;
  }[];
  intervals?: {
    name: string;
    time: string;
    distance: string;
    portion?: { from: number; to: number };
    /** The zone the row is coloured by, from its mean power or heart rate. */
    band?: number;
  }[];
  zones?: { label: string; rows: { name: string; share: number }[] }[];
  notes?: { label: string; value: string }[];
};

/** Where the pointer rests on the chart, shared with the map slot. */
export type Position = { index: number; time: number; distance: number };

/** The lanes in the order they stack, each with its stream colour and how its values are drawn. */
const LANES: {
  key: string;
  label: ParseKeys;
  unit: string;
  stream: ChartStream;
  scale?: number;
  fill?: boolean;
  zero?: boolean;
  /** Writes a value as the lane's readout and range chip do, where the plain figure would not read. */
  format?: (value: number) => string;
}[] = [
  {
    key: "altitude",
    label: "connectPage.chart.elevation",
    unit: "m",
    stream: "elevation",
    fill: true,
  },
  {
    key: "heartrate",
    label: "connectPage.chart.heartRate",
    unit: "bpm",
    stream: "heartrate",
  },
  {
    key: "watts",
    label: "connectPage.chart.power",
    unit: "W",
    stream: "power",
    zero: true,
  },
  {
    key: "velocity",
    label: "connectPage.chart.speed",
    unit: "km/h",
    stream: "speed",
    scale: 3.6,
    zero: true,
  },
  {
    key: "pace",
    label: "connectPage.chart.pace",
    unit: "min/km",
    stream: "pace",
    format: paceText,
  },
  { key: "gap", label: "connectPage.chart.gap", unit: "min/km", stream: "gap" },
  {
    key: "cadence",
    label: "connectPage.chart.cadence",
    unit: "rpm",
    stream: "cadence",
    zero: true,
  },
  {
    key: "grade",
    label: "connectPage.chart.grade",
    unit: "%",
    stream: "grade",
  },
  {
    key: "wbal",
    label: "connectPage.chart.wbal",
    unit: "kJ",
    stream: "wbal",
    scale: 0.001,
    zero: true,
  },
  {
    key: "temp",
    label: "connectPage.chart.temperature",
    unit: "°C",
    stream: "temp",
  },
];

type ColourBy = "none" | TrackColour["stream"];

/**
 * The activity's streams with a pace series, minutes per kilometre from the
 * speed stream, for a run or a walk; a stopped sample has no pace. Any other
 * sport's streams come back as they are.
 */
export function withPace(
  data: ChartData | null,
  sportType: string | null | undefined,
): ChartData | null {
  const family = sportMark(sportType).family;
  const speed = data?.series["velocity"];
  if (!data || !speed || (family !== "run" && family !== "walk")) return data;
  return {
    ...data,
    series: {
      ...data.series,
      pace: speed.map((metres) => (metres > 0 ? 1000 / metres / 60 : NaN)),
    },
  };
}

/** The streams the track can be coloured by for this activity, in the order the control lists them. */
function colourChoicesOf(
  data: ChartData | null,
  detail: DetailData | undefined,
): {
  value: TrackColour["stream"];
  label: ParseKeys;
  colour: (data: ChartData) => TrackColour | null;
}[] {
  if (!data) return [];
  const has = (key: string) => (data.series[key]?.length ?? 0) > 0;
  const choices: ReturnType<typeof colourChoicesOf> = [];
  if (has("watts") && detail?.powerZones?.length) {
    const zones = detail.powerZones.map((band) => ({
      zone: band.zone,
      upper: band.maxWatts ?? null,
    }));
    choices.push({
      value: "power",
      label: "connectPage.chart.power",
      colour: (d) => ({
        stream: "power",
        values: d.series["watts"] ?? [],
        distance: d.distance,
        zones,
      }),
    });
  }
  if (has("heartrate") && detail?.hrZones?.length) {
    const zones = detail.hrZones.map((band) => ({
      zone: band.zone,
      upper: band.maxBpm,
    }));
    choices.push({
      value: "heartrate",
      label: "connectPage.chart.heartRate",
      colour: (d) => ({
        stream: "heartrate",
        values: d.series["heartrate"] ?? [],
        distance: d.distance,
        zones,
      }),
    });
  }
  if (has("velocity")) {
    choices.push({
      value: "speed",
      label: "connectPage.chart.speed",
      colour: (d) => ({
        stream: "speed",
        values: d.series["velocity"] ?? [],
        distance: d.distance,
      }),
    });
  }
  if (has("grade")) {
    choices.push({
      value: "grade",
      label: "connectPage.chart.grade",
      colour: (d) => ({
        stream: "grade",
        values: d.series["grade"] ?? [],
        distance: d.distance,
      }),
    });
  }
  return choices;
}

export function ActivityPage(props: {
  id: string;
  /** The activity as the engine stores it, read for this id whether or not the feed lists it. */
  record: FfiActivityRecord | null | undefined;
  detail: Detail | undefined;
  /** The engine's whole detail for the activity; the header, the figures and the map's presence read it. */
  detailData?: DetailData | undefined;
  data: ChartData | null;
  facts?: Facts;
  /** Told the samples a brush on the charts covers, or null when the zoom is reset. */
  onRange?: (range: IndexRange | null) => void;
  /** Told where the crosshair is, or null when it leaves, so the map can mark it. */
  onPosition?: (position: Position | null) => void;
  /** The activity's stored sets; strength sessions only. */
  exercises?: FfiExerciseSession | undefined;
  /** The query layer the map slot reads the phone through; without it the slot stays empty. */
  queries?: QueryClient;
  /** Changes when the library does, so the map names its track by a new url. */
  revision?: number;
  /** How the series read stands, so the charts say why they are empty. */
  series?: { loading: boolean; error: ReadError | null };
}) {
  const { record, detail, detailData } = props;
  const data = useMemo(
    () => withPace(props.data, record?.sportType),
    [props.data, record?.sportType],
  );
  const { t } = useTranslation();
  usePageName(record?.name);
  const [position, setPosition] = useState<Position | null>(null);
  // A pointer over the track knows the sample and not its time or distance; the
  // streams do, so the crosshair reads the same from either side.
  const publish = (next: Position | null) => {
    const placed =
      next && data
        ? {
            index: next.index,
            time: data.time[next.index] ?? next.time,
            distance: data.distance[next.index] ?? next.distance,
          }
        : next;
    setPosition(placed);
    props.onPosition?.(placed);
  };
  const facts = props.facts ?? {};
  const [litSection, setLitSection] = useState<string | null>(null);
  const [range, setRange] = useState<IndexRange | null>(null);
  const [pickedLap, setPickedLap] = useState<string | null>(null);
  // While a section is being cut the range is its ends, whatever sets it.
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const samples = data?.time.length ?? 0;
  const cutRange = range ?? { from: 0, to: Math.max(0, samples - 1) };
  // A brush or a reset on the charts is not an interval any longer.
  const publishRange = (next: IndexRange | null) => {
    setPickedLap(null);
    setRange(next);
    props.onRange?.(next);
  };
  const pickLap = (key: string | null, portion: IndexRange | undefined) => {
    const next = key === null || !portion ? null : portion;
    setPickedLap(next ? key : null);
    setRange(next);
    props.onRange?.(next);
  };
  const [colourBy, setColourBy] = useState<ColourBy>("none");
  const colourChoices = useMemo(
    () => colourChoicesOf(data, detailData),
    [data, detailData],
  );
  const colour = useMemo<TrackColour | null>(() => {
    const choice = colourChoices.find((entry) => entry.value === colourBy);
    return data && choice ? choice.colour(data) : null;
  }, [colourBy, colourChoices, data]);
  const hasTrack = detailData ? detailData.hasGpsTrack : undefined;
  const showMap = Boolean(props.queries) && hasTrack !== false;
  const summary = statGroups({ record, summary: detail, detail: detailData });
  return (
    <section id="activity-page">
      <ActivityHeader
        onManage={() => setManaging(true)}
        id={props.id}
        record={record}
        detailData={detailData}
        data={data}
        queries={props.queries}
        onCreateSection={
          props.queries && data && samples >= 5 && !creating
            ? () => setCreating(true)
            : null
        }
      />
      {managing && props.queries ? (
        <ManageActivity id={props.id} onClose={() => setManaging(false)} />
      ) : null}
      <div id="activity-top" data-map={showMap ? "track" : "none"}>
        {showMap && props.queries ? (
          <div
            id="activity-map"
            role="region"
            aria-label={t("connectPage.activity.map")}
          >
            <ActivityMap
              id={props.id}
              revision={props.revision ?? 0}
              queries={props.queries}
              position={position}
              onPosition={publish}
              litSection={litSection}
              onLitSection={setLitSection}
              compare={[]}
              range={creating ? cutRange : range}
              colour={colour}
              create={
                creating
                  ? {
                      labels: {
                        start: t("connectPage.activity.createStartHandle"),
                        end: t("connectPage.activity.createEndHandle"),
                      },
                      onRange: publishRange,
                    }
                  : null
              }
            />
            {colourChoices.length > 0 ? (
              <SegmentedControl
                id="activity-colour"
                label={t("connectPage.activity.colourBy")}
                value={colourBy}
                options={[
                  {
                    value: "none",
                    label: t("connectPage.activity.colourNone"),
                  },
                  ...colourChoices.map((entry) => ({
                    value: entry.value,
                    label: t(entry.label),
                  })),
                ]}
                onChange={setColourBy}
              />
            ) : null}
          </div>
        ) : (
          <p id="map-empty" className="ui-empty" role="status">
            {t("connectPage.activity.noTrack")}
          </p>
        )}
        {creating && props.queries && data ? (
          <CreateSectionPanel
            id={props.id}
            sport={record?.sportType ?? ""}
            distance={data.distance}
            range={cutRange}
            queries={props.queries}
            onRange={publishRange}
            onClose={() => setCreating(false)}
          />
        ) : (
          <StatGroups groups={summary} />
        )}
      </div>
      <ActivityLanes
        data={data}
        series={props.series}
        position={position}
        onPosition={publish}
        onRange={publishRange}
        range={range}
        focus={pickedLap === null ? null : range}
      />
      <ActivityTabs
        facts={facts}
        detailData={detailData}
        exercises={props.exercises}
        range={range}
        pickedLap={pickedLap}
        onPickLap={pickLap}
        position={position}
        lit={litSection}
        onLit={setLitSection}
      />
      <Notes notes={facts.notes} />
    </section>
  );
}

const PROVENANCE_KEYS = {
  intervals: "connectPage.activity.provenance.intervals",
  garminOnPhone: "connectPage.activity.provenance.garminOnPhone",
} as const;

/** The date and time of a stored local start, as `2026-05-02 08:15`. */
const whenOf = (start: string | null | undefined) =>
  start ? start.slice(0, 16).replace("T", " ") : undefined;

/** The shared detail header: when and what, where the data came from, and what can be done with the activity. */
function ActivityHeader(props: {
  id: string;
  record: FfiActivityRecord | null | undefined;
  detailData: DetailData | undefined;
  data: ChartData | null;
  queries: QueryClient | undefined;
  /** Opens the section cutter; null when the ride cannot be cut or it is open. */
  onCreateSection: (() => void) | null;
  /** Opens the Manage panel. */
  onManage: () => void;
}) {
  const { record, detailData, queries } = props;
  const { t } = useTranslation();
  const mark = sportMark(record?.sportType);
  const provenance = detailData?.provenance;
  const intervalsId = detailData?.intervalsId;
  const items: MenuItem[] = [];
  if (queries && detailData?.hasGpsTrack) {
    items.push({
      id: "export-gpx",
      label: t("connectPage.activity.exportGpx"),
      onSelect: () =>
        void exportGpx(
          queries,
          props.id,
          record?.name ?? props.id,
          props.data?.series["altitude"],
        ),
    });
  }
  if (queries) {
    items.push({
      id: "manage",
      label: t("connectPage.activity.manage"),
      onSelect: props.onManage,
    });
  }
  return (
    <DetailHeader
      id="activity-header"
      metaId="activity-when"
      glyph={
        <SportGlyph family={mark.family} label={record?.sportType ?? ""} />
      }
      meta={[whenOf(record?.startDateLocal), record?.sportType]
        .filter(Boolean)
        .join(" · ")}
      note={provenance ? t(PROVENANCE_KEYS[provenance]) : undefined}
      actionsLabel={t("connectPage.activity.actions")}
      primary={[
        queries && detailData?.hasGpsTrack ? (
          <Button
            size="sm"
            disabled={props.onCreateSection === null}
            onClick={props.onCreateSection ?? undefined}
          >
            {t("connectPage.activity.createSection")}
          </Button>
        ) : null,
        intervalsId ? (
          <LinkButton
            size="sm"
            href={`https://intervals.icu/activities/${encodeURIComponent(intervalsId)}`}
          >
            {t("connectPage.activity.openOnIntervals")}
          </LinkButton>
        ) : null,
      ]}
      menu={{
        label: t("connectPage.activity.actions"),
        trigger: t("connectPage.activity.more"),
        items,
      }}
    />
  );
}

/** Saves the activity's track as a GPX file; a track the phone does not send saves nothing. */
async function exportGpx(
  queries: QueryClient,
  id: string,
  name: string,
  altitude?: readonly number[],
) {
  const positions = trackPositions(await geoText(queries, "geo.track", id));
  if (positions.length === 0) return;
  saveText(
    `${name}.gpx`,
    "application/gpx+xml",
    gpxOf(name, positions, altitude),
  );
}

type XAxisChoice = "distance" | "time";

function ActivityLanes(props: {
  data: ChartData | null;
  series: { loading: boolean; error: ReadError | null } | undefined;
  position: Position | null;
  onPosition: (position: Position | null) => void;
  onRange?: (range: IndexRange | null) => void;
  range: IndexRange | null;
  /** A range set from outside the chart, such as a chosen interval. */
  focus: IndexRange | null;
}) {
  const { data } = props;
  const { t } = useTranslation();
  const [axis, setAxis] = useState<XAxisChoice>("distance");
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const recorded = useMemo(
    () => (data ? LANES.filter((lane) => seriesRange(data, lane.key)) : []),
    [data],
  );
  const lanes = useMemo<LaneSeries[]>(
    () =>
      data
        ? recorded
            .filter((lane) => !off.has(lane.key))
            .map((lane) => {
              const scale = lane.scale ?? 1;
              return {
                key: lane.key,
                name: t(lane.label),
                unit: lane.unit,
                colour: streamColour(lane.stream),
                values:
                  scale === 1
                    ? (data.series[lane.key] ?? [])
                    : (data.series[lane.key] ?? []).map((v) => v * scale),
                ...(lane.fill ? { fill: true } : {}),
                ...(lane.zero ? { zero: true } : {}),
                ...(lane.format ? { format: lane.format } : {}),
              };
            })
        : [],
    [data, recorded, off, t],
  );
  if (!data || data.time.length === 0 || recorded.length === 0) {
    return (
      <Card label={t("connectPage.activity.charts")}>
        <CardHeader title={t("connectPage.activity.charts")} />
        {props.series?.error ? (
          <ReadNotice error={props.series.error} />
        ) : props.series?.loading ? (
          <Skeleton label={t("connectPage.read.loading")} />
        ) : (
          <EmptyState title={t("connectPage.activity.noSeries")} />
        )}
      </Card>
    );
  }
  const hasDistance = (data.distance[data.distance.length - 1] ?? 0) > 0;
  const shown: XAxisChoice = hasDistance ? axis : "time";
  const onAt = (next: number | null) => {
    const sample = next === null ? null : crosshair(data, [], next);
    props.onPosition(
      sample
        ? { index: sample.index, time: sample.time, distance: sample.distance }
        : null,
    );
  };
  const reading = props.position
    ? `${km(props.position.distance)} · ${clock(props.position.time)}`
    : null;
  const toggle = (key: string) =>
    setOff((held) => {
      const next = new Set(held);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <Card label={t("connectPage.activity.charts")}>
      <CardHeader
        title={t("connectPage.activity.charts")}
        actions={
          <>
            <span id="crosshair-reading">{reading}</span>
            {hasDistance ? (
              <SegmentedControl
                id="activity-axis"
                label={t("connectPage.chart.axis")}
                value={shown}
                options={[
                  { value: "distance", label: t("connectPage.facts.distance") },
                  { value: "time", label: t("connectPage.chart.time") },
                ]}
                onChange={(next) => {
                  // The lanes start afresh on the other axis, so the brush on this one is gone.
                  props.onRange?.(null);
                  setAxis(next);
                }}
              />
            ) : null}
          </>
        }
      />
      <ChipGroup label={t("connectPage.activity.streams")}>
        {recorded.map((lane) => (
          <Chip
            key={lane.key}
            selected={!off.has(lane.key)}
            onToggle={() => toggle(lane.key)}
          >
            <span
              className="swatch"
              style={{ background: streamColour(lane.stream) }}
              aria-hidden="true"
            />
            {t(lane.label)}
          </Chip>
        ))}
      </ChipGroup>
      <RangeReadoutBar data={data} range={props.range} />
      <div id="activity-lanes">
        {lanes.length === 0 ? (
          <EmptyState title={t("connectPage.activity.noStreamsShown")} />
        ) : (
          <Lanes
            key={shown}
            xs={shown === "distance" ? data.distance : data.time}
            xKind={shown === "distance" ? "number" : "duration"}
            xFormat={(value) =>
              shown === "distance"
                ? distanceValue(value)
                : elapsed(value * 1000)
            }
            xTitle={
              shown === "distance"
                ? `${t("connectPage.facts.distance")} (${distanceUnit()})`
                : `${t("connectPage.chart.time")} (h:mm:ss)`
            }
            lanes={lanes}
            at={props.position?.index ?? null}
            onAt={onAt}
            focus={props.focus}
            {...(props.onRange ? { onRange: props.onRange } : {})}
            label={t("connectPage.activity.charts")}
            none="–"
          />
        )}
      </div>
    </Card>
  );
}

/** A mean as a figure: whole above 100, one decimal below. */
const figure = (value: number) =>
  Math.abs(value) >= 100
    ? String(Math.round(value))
    : String(Math.round(value * 10) / 10);

/** What the brushed range covers and the mean of each stream over it; absent while no range is set. */
function RangeReadoutBar({
  data,
  range,
}: {
  data: ChartData;
  range: IndexRange | null;
}) {
  const { t } = useTranslation();
  const readout = rangeReadout(data, range);
  if (!readout) return null;
  return (
    <p id="range-readout" role="status">
      <span>{t("connectPage.activity.range")}</span>
      <span>{km(readout.metres)}</span>
      <span>{elapsed(readout.seconds * 1000)}</span>
      {LANES.filter((lane) => readout.averages[lane.key] !== undefined).map(
        (lane) => (
          <span key={lane.key}>
            {t(lane.label)}{" "}
            {(lane.format ?? figure)(
              (readout.averages[lane.key] ?? 0) * (lane.scale ?? 1),
            )}{" "}
            {lane.unit}
          </span>
        ),
      )}
    </p>
  );
}

const GROUP_LABELS = {
  time: "connectPage.activity.group.time",
  speed: "connectPage.activity.group.speed",
  heartRate: "connectPage.activity.group.heartRate",
  power: "connectPage.activity.group.power",
  load: "connectPage.activity.group.load",
  energy: "connectPage.activity.group.energy",
  conditions: "connectPage.activity.group.conditions",
  newGround: "connectPage.activity.group.newGround",
} as const satisfies Record<StatGroupKey, ParseKeys>;

const STAT_LABELS = {
  distance: "connectPage.facts.distance",
  movingTime: "connectPage.facts.movingTime",
  elapsedTime: "connectPage.facts.elapsedTime",
  climbing: "connectPage.facts.climbing",
  averageSpeed: "connectPage.facts.averageSpeed",
  topSpeed: "connectPage.facts.topSpeed",
  averageHr: "connectPage.facts.averageHr",
  maxHr: "connectPage.facts.maxHr",
  averagePower: "connectPage.facts.averagePower",
  maxPower: "connectPage.facts.maxPower",
  trainingLoad: "connectPage.facts.trainingLoad",
  fitness: "connectPage.facts.fitness",
  fatigue: "connectPage.facts.fatigue",
  form: "connectPage.facts.form",
  calories: "connectPage.facts.calories",
  temperature: "connectPage.facts.temperature",
  wind: "connectPage.facts.wind",
  newGround: "connectPage.facts.newGround",
} as const satisfies Record<StatKey, ParseKeys>;

function StatGroups({ groups }: { groups: StatGroup[] }) {
  const { t } = useTranslation();
  return (
    <div
      id="activity-summary"
      role="group"
      aria-label={t("connectPage.activity.facts")}
    >
      {groups.map((group) => (
        <section
          key={group.key}
          data-group={group.key}
          aria-label={t(GROUP_LABELS[group.key])}
        >
          <h2>{t(GROUP_LABELS[group.key])}</h2>
          <dl>
            {group.rows.map((row) => (
              <div key={row.key}>
                <dt>{t(STAT_LABELS[row.key])}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

type TabId =
  | "intervals"
  | "zones"
  | "sections"
  | "route"
  | "exercises"
  | "lengths";

/**
 * The tables under the charts, one tab for each part of the activity that has
 * data: a tab for something the activity does not carry is left out, and with
 * none to offer nothing is drawn. The chosen tab is kept in the address.
 */
function ActivityTabs(props: {
  facts: Facts;
  detailData: DetailData | undefined;
  exercises: FfiExerciseSession | undefined;
  range: IndexRange | null;
  pickedLap: string | null;
  onPickLap: (key: string | null, portion: IndexRange | undefined) => void;
  position: Position | null;
  lit: string | null;
  onLit: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const { facts, detailData } = props;
  const swim = detailData?.poolSwim;
  const lengths = swim && swim.state === "read" && swim.lengths.length > 0 ? swim : null;
  const sets = props.exercises?.groups ?? [];
  const items: { id: TabId; label: string; panel: ReactNode }[] = [];
  if (facts.intervals?.length) {
    items.push({
      id: "intervals",
      label: t("connectPage.activity.intervals"),
      panel: (
        <Laps
          laps={facts.intervals}
          picked={props.pickedLap}
          onPick={props.onPickLap}
        />
      ),
    });
  }
  if (facts.zones?.length) {
    items.push({
      id: "zones",
      label: t("connectPage.activity.tab.zones"),
      panel: (
        <Zones
          zones={facts.zones}
          maxHr={detailData?.maxHr}
          source={detailData?.maxHrSource}
        />
      ),
    });
  }
  const leftOut: NonNullable<Facts["passes"]> = (facts.memberships ?? [])
    .filter((member) => member.kind === "section" && member.excluded)
    .map((member) => ({
      id: member.id,
      name: member.name,
      lapTime: "",
      rank: null,
      pr: false,
      history: [],
      current: 0,
      excluded: true,
    }));
  if (facts.passes?.length || leftOut.length) {
    items.push({
      id: "sections",
      label: t("connectPage.activity.sections"),
      panel: (
        <Passes
          passes={[...(facts.passes ?? []), ...leftOut]}
          position={props.position}
          lit={props.lit}
          onLit={props.onLit}
        />
      ),
    });
  } else if (facts.sections?.length) {
    items.push({
      id: "sections",
      label: t("connectPage.activity.sections"),
      panel: (
        <Sections
          sections={rowsInRange(facts.sections, props.range)}
          position={props.position}
          lit={props.lit}
          onLit={props.onLit}
        />
      ),
    });
  }
  if (facts.standing?.length) {
    items.push({
      id: "route",
      label: t("connectPage.activity.tab.route"),
      panel: <Standing standing={facts.standing} />,
    });
  } else if (facts.routes?.length) {
    items.push({
      id: "route",
      label: t("connectPage.activity.tab.route"),
      panel: <Routes routes={facts.routes} />,
    });
  }
  if (sets.length > 0) {
    items.push({
      id: "exercises",
      label: t("connectPage.activity.tab.exercises"),
      panel: <Exercises session={props.exercises as FfiExerciseSession} />,
    });
  }
  if (lengths) {
    items.push({
      id: "lengths",
      label: t("connectPage.activity.tab.lengths"),
      panel: <PoolLengths swim={lengths} />,
    });
  }
  if (items.length === 0) return null;
  return (
    <div id="activity-tables">
      <Tabs label={t("connectPage.activity.tab.label")} items={items} />
    </div>
  );
}

function Zones({
  zones,
  maxHr,
  source,
}: {
  zones: NonNullable<Facts["zones"]>;
  maxHr: number | undefined;
  source: DetailData["maxHrSource"] | undefined;
}) {
  const { t } = useTranslation();
  type Row = { name: string; share: number };
  const columns: Column<Row>[] = [
    { key: "name", header: "", clip: true, cell: (row) => row.name },
    {
      key: "share",
      header: "%",
      numeric: true,
      cell: (row) => `${Math.round(row.share * 100)}`,
    },
  ];
  return (
    <>
      <PageGrid className="activity-zones">
        {zones.map((zone) => (
          <GridCell key={zone.label}>
            <Card label={zone.label}>
              <CardHeader title={zone.label} />
              <DataTable
                label={zone.label}
                columns={columns}
                rows={zone.rows}
                rowKey={(r) => r.name}
              />
            </Card>
          </GridCell>
        ))}
      </PageGrid>
      {maxHr && source ? (
        <p id="max-hr-source">
          {t("connectPage.activity.maxHr", {
            bpm: maxHr,
            source: t(MAX_HR_SOURCES[source]),
          })}
        </p>
      ) : null}
    </>
  );
}

const MAX_HR_SOURCES = {
  activityZones: "connectPage.activity.maxHrSource.activityZones",
  sportSettings: "connectPage.activity.maxHrSource.sportSettings",
  default: "connectPage.activity.maxHrSource.default",
} as const satisfies Record<DetailData["maxHrSource"], ParseKeys>;

/** Choosing a row brushes its range on the charts and the map; choosing it again lifts the brush. */
function Laps({
  laps,
  picked,
  onPick,
}: {
  laps: NonNullable<Facts["intervals"]>;
  picked: string | null;
  onPick: (key: string | null, portion: IndexRange | undefined) => void;
}) {
  const { t } = useTranslation();
  type Row = NonNullable<Facts["intervals"]>[number] & { key: string };
  const rows: Row[] = laps.map((lap, at) => ({ ...lap, key: String(at) }));
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("connectPage.activity.intervals"),
      clip: true,
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
    <DataTable
      label={t("connectPage.activity.intervals")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      rowProps={(row) => ({
        "data-zone": row.band === undefined ? undefined : String(row.band),
      })}
      selectedKey={picked}
      onRowClick={(row) => onPick(picked === row.key ? null : row.key, row.portion)}
    />
  );
}

/** A section's times in date order as a line, this pass marked. */
function History({ times, current }: { times: number[]; current: number }) {
  return (
    <Sparkline
      className="history-line"
      range="fit"
      height={20}
      lines={[{ values: times }]}
      marker={{ line: 0, index: current }}
    />
  );
}

/** One row per pass over a section in the order the track meets them. */
function Passes(props: {
  passes: NonNullable<Facts["passes"]>;
  position: Position | null;
  lit: string | null;
  onLit: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  type Row = NonNullable<Facts["passes"]>[number];
  const keyOf = (row: Row) => row.key ?? row.id;
  const numbers = numberSections(props.passes.map((row) => row.id));
  const columns: Column<Row>[] = [
    {
      key: "number",
      header: "#",
      numeric: true,
      cell: (row) => (row.excluded ? "" : (numbers.get(row.id) ?? "")),
    },
    {
      key: "name",
      header: t("connectPage.activity.sections"),
      clip: true,
      cellProps: (row) => ({ title: row.name }),
      cell: (row) => (
        <a
          href={`#/section/${encodeURIComponent(row.id)}`}
          onPointerEnter={() => props.onLit(row.id)}
          onPointerLeave={() => props.onLit(null)}
        >
          {row.name}
        </a>
      ),
    },
    {
      key: "lapTime",
      header: t("connectPage.facts.time"),
      numeric: true,
      cell: (row) => row.lapTime,
    },
    {
      key: "rank",
      header: t("connectPage.activity.rank"),
      numeric: true,
      cell: (row) =>
        row.excluded
          ? t("connectPage.routes.excluded")
          : row.pr
          ? t("connectPage.activity.record")
          : row.rank === null
            ? ""
            : String(row.rank),
    },
    {
      key: "history",
      header: t("connectPage.activity.history"),
      cell: (row) =>
        row.history.length > 0 ? (
          <History times={row.history} current={row.current} />
        ) : null,
    },
  ];
  return (
    <DataTable
      label={t("connectPage.activity.sections")}
      columns={columns}
      rows={props.passes}
      rowKey={keyOf}
      rowProps={(row) => ({ "data-excluded": row.excluded ? "true" : undefined })}
      selectedKey={props.lit}
      isSelected={(row) => props.lit === row.id}
      onRowHover={(row) => props.onLit(row?.id ?? null)}
      href={(row) => `#/section/${encodeURIComponent(row.id)}`}
    />
  );
}

function Sections(props: {
  sections: NonNullable<Facts["sections"]>;
  position: Position | null;
  lit: string | null;
  onLit: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const { lit, onLit: setLit } = props;
  type Row = NonNullable<Facts["sections"]>[number];
  const held = props.sections.find((row) =>
    portionHolds(row.portion, props.position?.index ?? null),
  );
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("connectPage.activity.sections"),
      clip: true,
      cellProps: (row) => ({ title: row.name }),
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
    <DataTable
      label={t("connectPage.activity.sections")}
      columns={columns}
      rows={props.sections}
      rowKey={(row) => row.id}
      selectedKey={lit ?? held?.id ?? null}
    />
  );
}

/** The route the activity rides, its best and mean times and the gap from this one to the best. */
function Standing({ standing }: { standing: NonNullable<Facts["standing"]> }) {
  const { t } = useTranslation();
  type Row = NonNullable<Facts["standing"]>[number];
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("connectPage.activity.tab.route"),
      clip: true,
      cellProps: (row) => ({ title: row.name }),
      cell: (row) => (
        <a href={`#/route/${encodeURIComponent(row.id)}`}>{row.name}</a>
      ),
    },
    {
      key: "rides",
      header: t("connectPage.activity.rides"),
      numeric: true,
      cell: (row) => row.rides,
    },
    {
      key: "best",
      header: t("connectPage.activity.best"),
      numeric: true,
      cell: (row) => row.best,
    },
    {
      key: "average",
      header: t("connectPage.activity.average"),
      numeric: true,
      cell: (row) => row.average,
    },
    {
      key: "gap",
      header: t("connectPage.activity.gapToBest"),
      numeric: true,
      cell: (row) => row.gap,
    },
  ];
  return (
    <DataTable
      label={t("connectPage.activity.tab.route")}
      columns={columns}
      rows={standing}
      rowKey={(row) => row.id}
    />
  );
}

function Routes({ routes }: { routes: NonNullable<Facts["routes"]> }) {
  const { t } = useTranslation();
  const columns: Column<LinkedRow>[] = [
    {
      key: "name",
      header: t("connectPage.activity.routes"),
      clip: true,
      cellProps: (row) => ({ title: row.name }),
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
    <DataTable
      label={t("connectPage.activity.routes")}
      columns={columns}
      rows={routes}
      rowKey={(row) => row.id}
    />
  );
}

/** A strength session's sets, grouped by exercise in the order they were done. */
function Exercises({ session }: { session: FfiExerciseSession }) {
  const { t } = useTranslation();
  type Row = FfiExerciseSession["groups"][number];
  const best = (group: Row) =>
    group.bestSet?.weightKg == null
      ? ""
      : `${group.bestSet.weightKg} kg × ${group.bestSet.repetitions ?? 1}`;
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("connectPage.strength.exercise"),
      clip: true,
      cell: (group) => group.name,
    },
    {
      key: "sets",
      header: t("connectPage.strength.colSets"),
      numeric: true,
      cell: (group) => String(group.sets.length),
    },
    {
      key: "reps",
      header: t("connectPage.strength.colReps"),
      numeric: true,
      cell: (group) =>
        String(group.sets.reduce((sum, set) => sum + (set.repetitions ?? 0), 0)),
    },
    {
      key: "best",
      header: t("connectPage.strength.colBestSet"),
      numeric: true,
      cell: best,
    },
  ];
  return (
    <DataTable
      label={t("connectPage.activity.tab.exercises")}
      columns={columns}
      rows={session.groups}
      rowKey={(group, ) => `${group.name}:${group.sets[0]?.setOrder ?? 0}`}
    />
  );
}

/** A pool swim's lengths in file order, rests in place. */
function PoolLengths({ swim }: { swim: FfiPoolSwim }) {
  const { t } = useTranslation();
  type Row = FfiPoolSwim["lengths"][number];
  const seconds = (value: number | null) =>
    value === null ? "" : elapsed(value * 1000);
  const columns: Column<Row>[] = [
    {
      key: "number",
      header: t("poolSwim.columns.number"),
      numeric: true,
      cell: (row) => String(row.index + 1),
    },
    {
      key: "stroke",
      header: t("poolSwim.columns.stroke"),
      cell: (row) =>
        row.active && row.strokeKey
          ? t(`poolSwim.strokes.${row.strokeKey}` as ParseKeys)
          : t("poolSwim.rest"),
    },
    {
      key: "time",
      header: t("poolSwim.columns.time"),
      numeric: true,
      cell: (row) => seconds(row.elapsedSecs),
    },
    {
      key: "strokes",
      header: t("poolSwim.columns.strokes"),
      numeric: true,
      cell: (row) => (row.strokes === null ? "" : String(row.strokes)),
    },
    {
      key: "swolf",
      header: t("poolSwim.columns.swolf"),
      numeric: true,
      cell: (row) => (row.swolf === null ? "" : String(Math.round(row.swolf))),
    },
  ];
  return (
    <DataTable
      label={t("poolSwim.lengths")}
      columns={columns}
      rows={swim.lengths}
      rowKey={(row) => String(row.index)}
    />
  );
}

function Notes({ notes }: { notes: Facts["notes"] }) {
  const label = notes?.[0]?.label ?? "";
  if (!notes?.length) return null;
  const columns: Column<{ label: string; value: string }>[] = [
    { key: "label", header: "", cell: (row) => row.label },
    { key: "value", header: "", cell: (row) => row.value },
  ];
  return (
    <Card label={label}>
      <DataTable
        label={label}
        columns={columns}
        rows={notes}
        rowKey={(r) => r.label}
      />
    </Card>
  );
}

/**
 * Every setting of this activity: whether it shows on the heatmap, and for
 * each route and section it matched whether it counts there. The state is the
 * phone's own, held by the read cache: each write names that read, so an edit
 * or its undo shows the state the phone now holds.
 */
export function ManageActivity(props: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const editor = useEdit();
  const detail = useRead("activity.detail", { id: props.id });
  const data = detail.data;
  if (!data) return null;
  const members = (kind: "route" | "section") =>
    (data.memberships ?? [])
      .filter((member) => member.kind === kind)
      .map((member) => ({
        id: member.id,
        label: member.name ?? member.id,
        on: !member.excluded,
        onChange: (on: boolean) =>
          void editor.run({
            kind: kind === "route" ? "routePass" : "sectionPass",
            id: member.id,
            activityId: props.id,
            excluded: !on,
          }),
      }));
  const groups: ManageGroup[] = [
    {
      id: "heatmap",
      title: t("connectPage.activity.manageHeatmap"),
      rows: [
        {
          id: "heatmap",
          label: t("connectPage.activity.showOnHeatmap"),
          on: !data.heatmapHidden,
          onChange: (on) =>
            void editor.run({
              kind: "heatmap",
              activityId: props.id,
              hidden: !on,
            }),
        },
      ],
    },
    {
      id: "routes",
      title: t("connectPage.activity.routes"),
      rows: members("route"),
    },
    {
      id: "sections",
      title: t("connectPage.activity.sections"),
      rows: members("section"),
    },
  ];
  return (
    <ManagePanel
      id="activity-manage"
      title={t("connectPage.activity.manage")}
      hint={t("connectPage.activity.manageHint")}
      closeLabel={t("common.close")}
      groups={groups}
      refusal={editor.refusal}
      onClose={props.onClose}
    />
  );
}

/** The activity the route opens, asking the phone for its detail, series and laps. */
export function ActivityRoute({ snapshot, route }: PageProps) {
  const id = route.id as string;
  const queries = useQueries();
  const [streams, laps, data, record] = useReads([
    { method: "activity.streams", args: { id, types: DETAIL_STREAM_TYPES } },
    { method: "activity.intervals", args: { id } },
    { method: "activity.detail", args: { id } },
    { method: "activity.record", args: { id } },
  ]);
  const summary = useRead("activity.summary", { id });
  const sets = useRead("activity.exerciseSets", { id });
  const recorded = (
    record?.data as Methods["activity.record"]["result"] | undefined
  )?.record;
  usePageName(recorded?.name);
  const missing = [streams, laps, data, record, summary].map(
    (read) => read?.error,
  );
  const absent = missing.find((error) => error?.kind === "unsupported");
  if (absent && missing.every((error) => error?.kind === "unsupported")) {
    return <ReadNotice error={absent} />;
  }
  return (
    <ActivityPage
      id={id}
      record={recorded}
      detail={summary.data ? { id, ...summary.data } : undefined}
      detailData={
        data?.data as Methods["activity.detail"]["result"] | undefined
      }
      data={chartDataOf(
        streams?.data as Methods["activity.streams"]["result"] | undefined,
      )}
      facts={factsOfDetail(
        laps?.data as Methods["activity.intervals"]["result"] | undefined,
        data?.data as Methods["activity.detail"]["result"] | undefined,
        id,
        summary.data?.movingTime,
      )}
      exercises={sets.data}
      queries={queries}
      revision={snapshot.libraryChanges}
      series={{
        loading: streams?.loading ?? false,
        error: streams?.error ?? null,
      }}
    />
  );
}
