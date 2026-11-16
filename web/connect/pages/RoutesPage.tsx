// The routes and sections pages: the list on the left, a slot for the map in
// the centre and the selected row's detail on the right. The list is the
// engine's own read for the sort, search and chips in the address; nothing
// here orders or counts what the engine did.

import type { ParseKeys } from "i18next";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DETAIL_STREAM_TYPES } from "../activity";
import { CompareOverlay } from "../CompareOverlay";
import { compareSet, compareTracks, MAX_COMPARED, type Compared } from "../compare";
import { clock, km } from "../format";
import { RoutesMap } from "../map/RoutesMap";
import { HOVER_TRACK_MS, withAsked } from "../map/routeLayers";
import { PassTable, type PassTableRow } from "../PassTable";
import { useTableLabels } from "../tableLabels";
import { pointsOf, sportMark, THUMB, trackShape } from "../preview";
import {
  Button,
  Card,
  Chip as ChipToggle,
  ChipGroup,
  DataTable,
  EmptyState,
  SearchField,
  Select,
  Skeleton,
  type Column,
} from "../ui";
import type { LatLng } from "../fit";
import {
  CHIPS,
  ROUTE_SORTS,
  SECTION_SORTS,
  fromRoute,
  passes,
  pressed,
  queryFor,
  toRoute,
  toggled,
  type Chip,
  type Kind,
  type ListState,
  type PassColumn,
} from "../routesList";
import {
  RANGE_DAYS,
  chartPointsOf,
  historyRowsOf,
  performanceAsk,
} from "../routesDetail";
import { useEdit } from "../useEdit";
import { formatOrder, go, parseOrder, type Ordering, type Route } from "../router";
import { usePageName } from "../shell/pageName";
import { useQueries, useReads } from "../useRead";
import type { ReadError } from "../query";
import type { Methods } from "../schema";
import { RoutePane, pickedSide, useRouteModel } from "./RouteDetail";
import {
  Facts,
  Refused,
  RenameField,
  useRouteRead,
} from "./routePanes";

type Screen = Methods["routes.screen"]["result"];
type SectionDetail = Methods["section.detail"]["result"];
type Performance = Methods["section.performance"]["result"];
type SectionHistory = Methods["section.history"]["result"];

const SORT_NAMES: Record<string, ParseKeys> = {
  nearby: "connectPage.routes.sortNearby",
  activities: "connectPage.routes.sortActivities",
  visits: "connectPage.routes.sortVisits",
  signature: "connectPage.routes.sortRelevance",
  distance: "connectPage.routes.sortDistance",
  name: "connectPage.routes.sortName",
};

const sortName = (key: string): ParseKeys =>
  SORT_NAMES[key] ?? "connectPage.routes.sortRelevance";

const CHIP_NAMES: Record<Chip, ParseKeys> = {
  custom: "connectPage.routes.chipCustom",
  removed: "connectPage.routes.chipRemoved",
  accepted: "connectPage.routes.chipAccepted",
};

/** Why a write is drawn and does nothing. */
const ON_PHONE: ParseKeys = "connectPage.routes.onPhone";

const ACTIONS: Record<ListState["kind"], ParseKeys[]> = {
  routes: [],
  sections: ["connectPage.routes.actionMerge", "connectPage.routes.actionTrim"],
};

/** How long typing pauses before the search is asked of the phone. */
const SEARCH_PAUSE_MS = 250;

const DEFAULT_ORDER = { column: "date", descending: true } as const;

/**
 * The tracks of the given activities, read through the shared layer, so a
 * series the activity page holds is not asked twice. An id whose read fails
 * has no track and is asked again when the set next changes.
 */
function useCompareStreams(ids: readonly string[]) {
  // The engine keys a stored stream on the exact type list the phone's own
  // detail charts ask for, so this asks the same one.
  const states = useReads(
    ids.map((id) => ({ method: "activity.streams", args: { id, types: DETAIL_STREAM_TYPES } }))
  );
  return useMemo(() => {
    const held: Record<string, readonly LatLng[]> = {};
    ids.forEach((id, at) => {
      const streams = states[at]?.data as Methods["activity.streams"]["result"] | undefined;
      if (streams) held[id] = pointsOf(streams.latlng);
    });
    return held;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states]);
}

type Row = {
  id: string;
  name: string;
  distance: string | null;
  count: number;
  bestTime: number | null;
  sports: string;
  /** The engine's encoded line, drawn small beside the name. */
  polyline: string;
};

/** The row's line fitted to a small square in its first sport's colour, or that sport's mark with no line. */
function RowThumb({ polyline, sports }: { polyline: string; sports: string }) {
  const sport = sportMark(sports.split(",")[0]);
  const shape = polyline ? trackShape(polyline) : null;
  if (!shape) {
    return (
      <span className="row-thumb" data-sport={sport.family} aria-hidden="true">
        {sport.mark}
      </span>
    );
  }
  return (
    <svg
      className="row-thumb"
      data-sport={sport.family}
      viewBox={`0 0 ${THUMB} ${THUMB}`}
      aria-hidden="true"
    >
      <path d={shape.path} className="thumb-line" />
    </svg>
  );
}

/** One list: its own search, sort and chips over the rows the engine answered for it. */
function ListColumn({
  state,
  read,
  onChange,
  onHover,
}: {
  state: ListState;
  read: { value: Screen | null; failed: boolean; error: ReadError | null };
  onChange: (next: Partial<ListState>) => void;
  onHover: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const tableLabels = useTableLabels();
  const sections = state.kind === "sections";
  const [text, setText] = useState(state.search);

  useEffect(() => {
    if (text === state.search) return undefined;
    const typing = setTimeout(
      () => onChange({ search: text, selected: null }),
      SEARCH_PAUSE_MS,
    );
    return () => clearTimeout(typing);
    // `onChange` is a new function each render; the text and the address say what to write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.search, text]);

  const rows: Row[] = sections
    ? (read.value?.sections ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? t("connectPage.routes.unnamedSection"),
        distance: km(row.distanceMeters),
        count: row.visitCount,
        bestTime: null,
        sports: row.sportTypes.join(", "),
        polyline: row.encodedPolyline,
      }))
    : (read.value?.groups ?? []).map((row) => ({
        id: row.groupId,
        name: row.customName ?? t("connectPage.routes.unnamedRoute"),
        distance: km(row.distanceMeters),
        count: row.activityCount,
        bestTime: row.bestTime,
        sports: row.sportTypes.join(", "),
        polyline: row.encodedPolyline,
      }));
  const total = sections
    ? read.value?.filteredSectionCount
    : read.value?.filteredGroupCount;
  const more = sections
    ? read.value?.hasMoreSections
    : read.value?.hasMoreGroups;
  const countSort = sections ? "visits" : "activities";
  const label = sections
    ? t("connectPage.routes.sections")
    : t("connectPage.routes.routes");
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t(sortName("name")),
      sortable: true,
      clip: true,
      cell: (row) => row.name,
    },
    {
      key: "distance",
      header: t(sortName("distance")),
      numeric: true,
      sortable: true,
      cell: (row) => row.distance,
    },
    {
      key: countSort,
      header: t(sortName(countSort)),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.count),
    },
    ...(sections
      ? []
      : [
          {
            key: "bestTime",
            header: t("connectPage.routes.bestTime"),
            numeric: true,
            defaultHidden: true,
            cell: (row: Row) => clock(row.bestTime),
          },
        ]),
    {
      key: "sports",
      header: t("connectPage.routes.type"),
      clip: true,
      defaultHidden: true,
      cell: (row) => row.sports,
    },
  ];
  const sorts: readonly string[] = sections ? SECTION_SORTS : ROUTE_SORTS;
  const sortOptions = sorts
    .filter((sort) => sort !== "nearby")
    .map((sort) => ({
      value: sort,
      label: SORT_NAMES[sort] ? t(SORT_NAMES[sort]) : sort,
    }));

  return (
    <div id={`${state.kind}-list`} className="pane">
      <Card label={label}>
        <div className="filter-bar">
          <SearchField
            label={
              sections
                ? t("connectPage.routes.searchSections")
                : t("connectPage.routes.searchRoutes")
            }
            clearLabel={t("connectPage.routes.searchHint")}
            placeholder={t("connectPage.routes.searchHint")}
            value={text}
            onChange={setText}
          />
          <Select
            label={t("connectPage.routes.sort")}
            value={state.sort}
            options={sortOptions}
            onChange={(sort) => onChange({ sort, selected: null })}
          />
          {sections ? (
            <ChipGroup label={t("connectPage.routes.show")}>
              {CHIPS.map((chip) => (
                <ChipToggle
                  key={chip}
                  selected={state.chips.includes(chip)}
                  onToggle={() =>
                    onChange({ ...toggled(state, chip), selected: null })
                  }
                >
                  {t(CHIP_NAMES[chip])}
                </ChipToggle>
              ))}
            </ChipGroup>
          ) : null}
        </div>
        {read.failed && read.error ? (
          <Refused
            error={read.error}
            title={t("connectPage.routes.listFailed")}
          />
        ) : !read.value ? (
          <Skeleton label={t("connectPage.routes.reading")} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("connectPage.routes.shown", { count: 0 })} />
        ) : (
          <DataTable
            label={label}
            tableId={`${state.kind}-list`}
            labels={tableLabels}
            marker={{
              header: null,
              cell: (row) => (
                <RowThumb polyline={row.polyline} sports={row.sports} />
              ),
            }}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            sort={{
              key: state.sort,
              direction: state.sort === "name" ? "asc" : "desc",
            }}
            onSort={(key) => onChange({ sort: key, selected: null })}
            selectedKey={state.selected}
            onRowClick={(row) => onChange({ selected: row.id })}
            onRowHover={(row) => onHover(row?.id ?? null)}
          />
        )}
        {total != null ? (
          <p className="meta">
            {t("connectPage.routes.shown", { count: total })}
          </p>
        ) : null}
        {more ? <p className="meta">{t("connectPage.routes.more")}</p> : null}
      </Card>
    </div>
  );
}

export function RoutesPage({ route }: { route: Route }) {
  const { t } = useTranslation();
  const queries = useQueries();
  const page = fromRoute(route);
  const sections = page?.focus === "sections";
  const focused = page ? page[page.focus] : null;
  const routeId = page?.focus === "routes" ? (focused?.selected ?? null) : null;
  const routeOpen = routeId !== null;
  const model = useRouteModel(routeId);
  // The row the pointer is on, in the table or on the map's line, kept with
  // the selection it was on so another selection starts with none lit.
  const selectionKey = `${page?.focus}:${focused?.selected ?? null}`;
  // The attempts selected on an open route, in the table, on a chart or on the map: one
  // selection, kept with the route it belongs to. The last is the one the map colours.
  const [chosen, setChosen] = useState<{ key: string; ids: string[] }>({
    key: selectionKey,
    ids: page?.focus === "routes" ? page.routes.ids : [],
  });
  const attempts = routeOpen && chosen.key === selectionKey ? chosen.ids : [];
  const picked = attempts[attempts.length - 1] ?? null;
  const side = routeOpen ? pickedSide(model, picked) : null;
  // The passes compared belong to the selected section or route: a section's come from the
  // address, a route's from its selection when two to four attempts are selected.
  const comparedIds = sections
    ? focused?.selected
      ? focused.ids
      : []
    : attempts.length >= 2 && attempts.length <= MAX_COMPARED
      ? attempts
      : [];
  const streams = useCompareStreams(comparedIds);
  const set = compareSet(comparedIds);
  const [pointed, setPointed] = useState<{ key: string; id: string | null }>({
    key: selectionKey,
    id: null,
  });
  const hovered = pointed.key === selectionKey ? pointed.id : null;
  const setHovered = (id: string | null) =>
    setPointed({ key: selectionKey, id });
  // An attempt's full track is asked for once the pointer has rested on it,
  // and kept for as long as the route is open.
  const [rested, setRested] = useState<{ key: string; id: string | null }>({
    key: selectionKey,
    id: null,
  });
  const [tracks, setTracks] = useState<{ key: string; asked: string[] }>({
    key: selectionKey,
    asked: [],
  });
  useEffect(() => {
    if (!routeOpen || hovered === null) return undefined;
    const rest = setTimeout(() => {
      setTracks((prior) => ({
        key: selectionKey,
        asked: withAsked(
          prior.key === selectionKey ? prior.asked : [],
          hovered,
        ) as string[],
      }));
      setRested({ key: selectionKey, id: hovered });
    }, HOVER_TRACK_MS);
    return () => clearTimeout(rest);
  }, [routeOpen, hovered, selectionKey]);
  const lit =
    hovered !== null && rested.key === selectionKey && rested.id === hovered
      ? hovered
      : null;
  const asked = withAsked(
    tracks.key === selectionKey ? tracks.asked : [],
    routeOpen ? picked : null,
  ) as string[];

  const list = useRouteRead<Screen>("routes.screen", page ? queryFor(page) : null);

  if (!page) return null;
  const shown = page[page.focus];
  // A different section starts its own selection, so the passes compared go with it.
  const change = (kind: Kind) => (next: Partial<ListState>) => {
    const held = page[kind];
    const moved = "selected" in next && next.selected !== held.selected;
    go(
      toRoute({
        ...page,
        focus: next.selected ? kind : page.focus,
        [kind]: { ...held, ids: moved ? [] : held.ids, ...next },
      }),
    );
  };

  const order = page.order;
  const onOrder = (next: Ordering<string>) =>
    go(toRoute({ ...page, order: formatOrder(next, DEFAULT_ORDER) }));
  const detailOpen = sections || routeOpen;

  return (
    <section
      id="routes-page"
      data-kind={page.focus}
      data-open={detailOpen || undefined}
    >
      <ListColumn
        state={shown}
        read={list}
        onChange={change(page.focus)}
        onHover={setHovered}
      />
      <div
        id="map-slot"
        className="pane"
        aria-label={t("connectPage.activity.map")}
      >
        <RoutesMap
          queries={queries}
          target={
            shown.selected
              ? { kind: sections ? "section" : "route", id: shown.selected }
              : { kind: page.focus }
          }
          hoveredRow={routeOpen ? lit : hovered}
          onHoverRow={setHovered}
          askedTracks={asked}
          selected={comparedIds}
          picked={routeOpen && picked && side ? { id: picked, side } : null}
          onOpen={(id) => change(page.focus)({ selected: id })}
          onPickPass={(id) =>
            change(page.focus)({
              ids: comparedIds.includes(id)
                ? comparedIds
                : [...comparedIds, id],
            })
          }
        />
        <CompareOverlay tracks={compareTracks(set, streams)} />
      </div>
      {detailOpen ? (
        <div id="routes-detail" className="pane">
          <Card
            label={
              sections
                ? t("connectPage.routes.passes")
                : t("connectPage.routes.routeDetail")
            }
          >
            {!sections && routeId ? (
              <>
                <p className="back">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => change("routes")({ selected: null })}
                  >
                    {`← ${t("connectPage.routes.allRoutes")}`}
                  </Button>
                </p>
                <RoutePane
                  id={routeId}
                  model={model}
                  selected={attempts}
                  set={set}
                  picked={picked}
                  order={order}
                  onOrder={onOrder}
                  onSelect={(ids) => {
                    setChosen({ key: selectionKey, ids });
                    // Two to four selected are the set the overlay draws, and the address keeps them.
                    change("routes")({
                      ids: ids.length >= 2 && ids.length <= MAX_COMPARED ? ids : [],
                    });
                  }}
                  onHover={setHovered}
                />
              </>
            ) : shown.selected ? (
              <SectionPane
                id={shown.selected}
                set={set}
                order={order}
                onOrder={onOrder}
                onSelect={(ids) => change("sections")({ ids })}
                hovered={hovered}
                onHover={setHovered}
              />
            ) : (
              <EmptyState title={t("connectPage.routes.pickSection")} />
            )}
            {ACTIONS[page.focus].length ? (
              <>
                <p className="actions">
                  {ACTIONS[page.focus].map((action) => (
                    <Button key={action} disabled title={t(ON_PHONE)}>
                      {t(action)}
                    </Button>
                  ))}
                </p>
                <p className="meta">{t(ON_PHONE)}</p>
              </>
            ) : null}
          </Card>
        </div>
      ) : null}
    </section>
  );
}

const PLOT_WIDTH = 400;
const PLOT_HEIGHT = 160;

/** Speed against date, one point per attempt, the best marked. */
function PerformanceChart({ performance }: { performance: Performance }) {
  const { t } = useTranslation();
  const points = chartPointsOf(
    performance.chartData.points,
    PLOT_WIDTH,
    PLOT_HEIGHT,
  );
  if (points.length === 0)
    return <p className="meta">{t("connectPage.routes.noAttempts")}</p>;
  return (
    <svg
      className="performance-chart"
      viewBox={`-8 -8 ${PLOT_WIDTH + 16} ${PLOT_HEIGHT + 16}`}
      role="img"
      aria-label={t("connectPage.routes.performanceChart")}
    >
      {points.map((point) => (
        <circle
          key={point.id}
          cx={point.x}
          cy={point.y}
          r={point.best ? 5 : 3}
          data-best={point.best}
        >
          <title>{point.name}</title>
        </circle>
      ))}
    </svg>
  );
}

function SectionPane({
  id,
  set,
  order: orderText,
  onOrder,
  onSelect,
  hovered,
  onHover,
}: {
  id: string;
  set: readonly Compared[];
  order: string | null;
  onOrder: (order: Ordering<string>) => void;
  onSelect: (ids: string[]) => void;
  hovered: string | null;
  onHover: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const editor = useEdit();
  const order = parseOrder<PassColumn>(
    orderText,
    ["date", "time", "delta"],
    DEFAULT_ORDER,
  );
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const read = useRouteRead<SectionDetail>("section.detail", { id });
  const detail = read.value;
  usePageName(read.value?.section?.name);
  if (read.failed && read.error)
    return (
      <Refused
        error={read.error}
        title={t("connectPage.routes.sectionFailed")}
      />
    );
  if (!detail) return <Skeleton label={t("connectPage.routes.reading")} />;
  const section = detail.section;
  const table = passes(detail.activityRows, order);
  const dateOf = (startTime: number) =>
    new Date(startTime * 1000).toISOString().slice(0, 10);
  const rows: PassTableRow[] = table.map((pass) => ({
    id: pass.activityId,
    elapsed: pass.movingTime,
    pr: pass.pr,
    label: (
      <a
        href={`#/activity/${encodeURIComponent(pass.activityId)}`}
        onClick={(event) => {
          // A plain click opens the activity; a modified one selects the row, as it does on the table.
          if (event.shiftKey || event.ctrlKey || event.metaKey)
            event.preventDefault();
          else event.stopPropagation();
        }}
      >
        {dateOf(pass.startTime)}
      </a>
    ),
    cells: [
      <>
        {clock(pass.movingTime)}
        {pass.pr ? ` ${t("connectPage.routes.pr")}` : ""}
      </>,
      pass.pr ? "" : `+${pass.delta} s`,
      <Button
        key="exclude"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          void editor.run({
            kind: "sectionPass",
            id,
            activityId: pass.activityId,
            excluded: true,
          });
        }}
      >
        {t("connectPage.routes.actionExcludePass")}
      </Button>,
    ],
  }));
  const names = dropped.map((dropId) => {
    const row = detail.activityRows.find(
      (candidate) => candidate.activityId === dropId,
    );
    return row ? dateOf(row.startTime) : dropId;
  });
  return (
    <>
      <h3 className="panel-title">
        {section?.name ?? t("connectPage.routes.unnamedSection")}
      </h3>
      <RenameField
        key={section?.name ?? ""}
        value={section?.name ?? ""}
        label={t("connectPage.routes.name")}
        editor={editor}
        edit={(name) => ({ kind: "renameSection", id, name, was: section?.name ?? "" })}
      />
      {section ? (
        <p className="actions">
          <ChipToggle
            selected={section.isLift}
            onToggle={() =>
              void editor.run({ kind: "setLift", id, isLift: !section.isLift })
            }
          >
            {t("connectPage.routes.lift")}
          </ChipToggle>
          <ChipToggle
            selected={!section.disabled}
            onToggle={() =>
              void editor.run({
                kind: "setEnabled",
                id,
                enabled: section.disabled,
              })
            }
          >
            {t("connectPage.routes.enabled")}
          </ChipToggle>
          {section.isUserDefined ? (
            <ChipToggle selected disabled onToggle={() => undefined}>
              {t("connectPage.routes.accepted")}
            </ChipToggle>
          ) : (
            <Button onClick={() => void editor.run({ kind: "accept", id })}>
              {t("connectPage.routes.actionAccept")}
            </Button>
          )}
        </p>
      ) : null}
      {editor.refusal ? (
        <p className="notice" role="alert">
          {editor.refusal}
        </p>
      ) : null}
      <Facts
        facts={[
          [t("connectPage.routes.passes"), String(detail.activityCount)],
          [t("connectPage.facts.distance"), km(section?.distanceMeters)],
          [t("connectPage.routes.type"), section?.sectionType ?? null],
        ]}
      />
      <SectionChart id={id} />
      {names.length > 0 ? (
        <p className="meta" role="status">
          {t("connectPage.compare.dropped", { names: names.join(", ") })}
        </p>
      ) : null}
      <PassTable
        rows={rows}
        set={set}
        anchor={anchor}
        hovered={hovered}
        onHover={onHover}
        columns={[
          {
            key: "date",
            header: t("connectPage.strength.colDate"),
            sortable: true,
          },
          {
            key: "time",
            header: t("connectPage.facts.time"),
            sortable: true,
          },
          {
            key: "delta",
            header: t("connectPage.routes.behindPr"),
            sortable: true,
            defaultHidden: true,
          },
          {
            key: "exclude",
            header: null,
            label: t("connectPage.routes.actionExcludePass"),
          },
        ]}
        sort={{
          key: order.column,
          direction: order.descending ? "desc" : "asc",
        }}
        onSort={(key) => onOrder(pressed(order, key as PassColumn))}
        onSelect={(ids, gone, picked) => {
          setAnchor(picked);
          setDropped(gone);
          onSelect(ids);
        }}
      />
      {detail.excludedActivityIds.length ? (
        <ul className="excluded">
          {detail.excludedActivityIds.map((activityId) => (
            <li key={activityId}>
              {activityId}{" "}
              <Button
                size="sm"
                onClick={() =>
                  void editor.run({
                    kind: "sectionPass",
                    id,
                    activityId,
                    excluded: false,
                  })
                }
              >
                {t("connectPage.routes.actionInclude")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <SectionHistoryPane id={id} />
      <details>
        <summary>
          {t("connectPage.routes.mergeCandidates", {
            n: detail.mergeCandidates.length,
          })}
        </summary>
        <ul>
          {detail.mergeCandidates.map((candidate, at) => (
            <li key={at}>{JSON.stringify(candidate)}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

function SectionChart({
  id,
}: {
  id: string;
}) {
  const performance = useRouteRead<Performance>("section.performance", performanceAsk(id, RANGE_DAYS));
  return performance.value ? (
    <PerformanceChart performance={performance.value} />
  ) : null;
}

/** The change ledger, oldest first, and the stored geometry versions. */
function SectionHistoryPane({
  id,
}: {
  id: string;
}) {
  const { t } = useTranslation();
  const read = useRouteRead<SectionHistory>("section.history", { id });
  if (read.failed && read.error)
    return (
      <Refused
        error={read.error}
        title={t("connectPage.routes.historyFailed")}
        plain
      />
    );
  if (!read.value) return null;
  const rows = historyRowsOf(read.value);
  return (
    <>
      <details open>
        <summary>{t("connectPage.routes.history", { n: rows.length })}</summary>
        <ol className="history">
          {rows.map((row) => (
            <li key={row.id} data-pinned={row.pinned}>
              <time dateTime={row.at}>{row.at.slice(0, 10)}</time> {row.kind}
              {row.version !== null
                ? ` · ${t("connectPage.routes.version", { n: row.version })}`
                : ""}
              {row.activities.length ? ` · ${row.activities.join(", ")}` : ""}
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>
          {t("connectPage.routes.geometryVersions", {
            n: read.value.geometryVersions.length,
          })}
        </summary>
        <ul>
          {read.value.geometryVersions.map((version) => (
            <li key={version.version} data-pinned={version.pinned}>
              {t("connectPage.routes.version", { n: version.version })} ·{" "}
              {version.createdAt.slice(0, 10)}
              {version.pinned ? ` · ${t("connectPage.routes.pinned")}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
