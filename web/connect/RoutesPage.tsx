// The routes and sections pages: the list on the left, a slot for the map in
// the centre and the selected row's detail on the right. The list is the
// engine's own read for the sort, search and chips in the address; nothing
// here orders or counts what the engine did.

import type { ParseKeys } from 'i18next';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DETAIL_STREAM_TYPES } from './activity';
import { CompareOverlay } from './CompareOverlay';
import { compareSet, compareTracks, type Compared } from './compare';
import { clock, km, kmh } from './format';
import { PassTable, type PassTableRow } from './PassTable';
import { pointsOf } from './preview';
import {
  Button,
  Card,
  CardHeader,
  Chip as ChipToggle,
  ChipGroup,
  DataTable,
  EmptyState,
  ErrorState,
  SearchField,
  Select,
  Skeleton,
  type Column,
} from './ui';
import type { LatLng } from './fit';
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
  type ListState,
  type PassColumn,
  type PassOrder,
} from './routesList';
import {
  ATTEMPT_COLUMNS,
  RANGE_DAYS,
  ROUTE_SLOTS,
  attemptsOf,
  chartPointsOf,
  historyRowsOf,
  performanceAsk,
  pressedAttempts,
  type Attempt,
  type AttemptColumn,
  type AttemptOrder,
} from './routesDetail';
import { write, type Route } from './router';
import type { Session } from './session';
import type { Methods } from './schema';

type Screen = Methods['routes.screen']['result'];
type RouteDetail = Methods['route.detail']['result'];
type SectionDetail = Methods['section.detail']['result'];
type Performance = Methods['section.performance']['result'];
type RouteAttempts = Methods['route.attempts']['result'];
type SectionHistory = Methods['section.history']['result'];

const SORT_NAMES: Record<string, ParseKeys> = {
  nearby: 'connectPage.routes.sortNearby',
  activities: 'connectPage.routes.sortActivities',
  visits: 'connectPage.routes.sortVisits',
  signature: 'connectPage.routes.sortRelevance',
  distance: 'connectPage.routes.sortDistance',
  name: 'connectPage.routes.sortName',
};

const CHIP_NAMES: Record<Chip, ParseKeys> = {
  custom: 'connectPage.routes.chipCustom',
  removed: 'connectPage.routes.chipRemoved',
  accepted: 'connectPage.routes.chipAccepted',
};

/** Why a write is drawn and does nothing. */
const ON_PHONE: ParseKeys = 'connectPage.routes.onPhone';

const ACTIONS: Record<ListState['kind'], ParseKeys[]> = {
  routes: ['connectPage.routes.actionRename', 'connectPage.routes.actionExcludeActivity'],
  sections: [
    'connectPage.routes.actionRename',
    'connectPage.routes.actionAccept',
    'connectPage.routes.actionRetire',
    'connectPage.routes.actionRestore',
    'connectPage.routes.actionMerge',
    'connectPage.routes.actionExcludePass',
    'connectPage.routes.actionTrim',
  ],
};

/** How long typing pauses before the search is asked of the phone. */
const SEARCH_PAUSE_MS = 250;

function go(route: Route) {
  location.hash = write(route);
}

/** The result of a read, or why there is none yet. */
function useRead<T>(
  load: (() => Promise<T>) | null,
  key: string
): { value: T | null; failed: boolean } {
  const [held, setHeld] = useState<{
    key: string;
    value: T | null;
    failed: boolean;
  }>({
    key,
    value: null,
    failed: false,
  });
  useEffect(() => {
    if (!load) return undefined;
    let current = true;
    load().then(
      (value) => current && setHeld({ key, value, failed: false }),
      () => current && setHeld({ key, value: null, failed: true })
    );
    return () => {
      current = false;
    };
    // `load` is a new function each render; the key says what it asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return held.key === key ? held : { value: null, failed: false };
}

/**
 * The tracks of the given activities, each read once and kept while the page
 * is mounted. An id whose read fails is asked again when the set next changes.
 */
function useCompareStreams(session: Session, ids: readonly string[]) {
  const [held, setHeld] = useState<Record<string, readonly LatLng[]>>({});
  const asked = useRef(new Set<string>());
  const key = ids.join('\n');
  useEffect(() => {
    for (const id of key ? key.split('\n') : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      // The engine keys a stored stream on the exact type list the phone's own
      // detail charts ask for, so this asks the same one.
      void (
        session.read('activity.streams', {
          id,
          types: DETAIL_STREAM_TYPES,
        }) as Promise<Methods['activity.streams']['result']>
      ).then(
        (streams) => setHeld((prior) => ({ ...prior, [id]: pointsOf(streams.latlng) })),
        () => asked.current.delete(id)
      );
    }
  }, [session, key]);
  return held;
}

export function RoutesPage({ session, route }: { session: Session; route: Route }) {
  const { t } = useTranslation();
  const state = fromRoute(route);
  const [text, setText] = useState(state?.search ?? '');
  const sections = state?.kind === 'sections';
  // The passes compared belong to the selected section, so none is held once
  // the pane has no selection.
  const comparedIds = sections && state?.selected ? state.ids : [];
  const streams = useCompareStreams(session, comparedIds);
  const set = compareSet(comparedIds);

  useEffect(() => {
    if (!state || text === state.search) return undefined;
    const typing = setTimeout(
      () => go(toRoute({ ...state, search: text, selected: null })),
      SEARCH_PAUSE_MS
    );
    return () => clearTimeout(typing);
  }, [state, text]);

  const listKey = state ? JSON.stringify(queryFor({ ...state, selected: null })) : '';
  const list = useRead<Screen>(
    state
      ? () => session.read('routes.screen', queryFor(state), ROUTE_SLOTS.routes) as Promise<Screen>
      : null,
    listKey
  );

  if (!state) return null;
  // A different row starts its own selection, so the passes compared go with it.
  const change = (next: Partial<ListState>) =>
    go(
      toRoute({
        ...state,
        ids: 'selected' in next && next.selected !== state.selected ? [] : state.ids,
        ...next,
      })
    );
  type Row = { id: string; name: string; distance: string | null; count: number; sports: string };
  const rows: Row[] = sections
    ? (list.value?.sections ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? t('connectPage.routes.unnamedSection'),
        distance: km(row.distanceMeters),
        count: row.visitCount,
        sports: row.sportTypes.join(', '),
      }))
    : (list.value?.groups ?? []).map((row) => ({
        id: row.groupId,
        name: row.customName ?? t('connectPage.routes.unnamedRoute'),
        distance: km(row.distanceMeters),
        count: row.activityCount,
        sports: row.sportTypes.join(', '),
      }));
  const total = sections ? list.value?.filteredSectionCount : list.value?.filteredGroupCount;
  const more = sections ? list.value?.hasMoreSections : list.value?.hasMoreGroups;
  const countSort = sections ? 'visits' : 'activities';
  const columns: Column<Row>[] = [
    { key: 'name', header: t(SORT_NAMES.name), sortable: true, cell: (row) => row.name },
    {
      key: 'distance',
      header: t(SORT_NAMES.distance),
      numeric: true,
      sortable: true,
      cell: (row) => row.distance,
    },
    {
      key: countSort,
      header: t(SORT_NAMES[countSort]),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.count),
    },
    { key: 'sports', header: t('connectPage.routes.type'), cell: (row) => row.sports },
  ];
  const sorts: readonly string[] = sections ? SECTION_SORTS : ROUTE_SORTS;
  const sortOptions = sorts
    .filter((sort) => sort !== 'nearby')
    .map((sort) => ({ value: sort, label: SORT_NAMES[sort] ? t(SORT_NAMES[sort]) : sort }));

  return (
    <section id="routes-page" data-kind={state.kind}>
      <div id="routes-list" className="pane">
        <Card label={sections ? t('connectPage.routes.sections') : t('connectPage.routes.routes')}>
          <CardHeader
            title={sections ? t('connectPage.routes.sections') : t('connectPage.routes.routes')}
            actions={
              <nav className="tabs" aria-label={t('connectPage.routes.kinds')}>
                <a href="#/routes" aria-current={!sections}>
                  {t('connectPage.routes.routes')}
                </a>
                <a href="#/sections" aria-current={sections}>
                  {t('connectPage.routes.sections')}
                </a>
              </nav>
            }
          />
          <div className="filter-bar">
            <SearchField
              label={
                sections
                  ? t('connectPage.routes.searchSections')
                  : t('connectPage.routes.searchRoutes')
              }
              clearLabel={t('connectPage.routes.searchHint')}
              placeholder={t('connectPage.routes.searchHint')}
              value={text}
              onChange={setText}
            />
            <Select
              label={t('connectPage.routes.sort')}
              value={state.sort}
              options={sortOptions}
              onChange={(sort) => change({ sort, selected: null })}
            />
            {sections ? (
              <ChipGroup label={t('connectPage.routes.show')}>
                {CHIPS.map((chip) => (
                  <ChipToggle
                    key={chip}
                    selected={state.chips.includes(chip)}
                    onToggle={() => change({ ...toggled(state, chip), selected: null })}
                  >
                    {t(CHIP_NAMES[chip])}
                  </ChipToggle>
                ))}
              </ChipGroup>
            ) : null}
          </div>
          {list.failed ? (
            <ErrorState title={t('connectPage.routes.listFailed')} />
          ) : !list.value ? (
            <Skeleton label={t('connectPage.routes.reading')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('connectPage.routes.shown', { count: 0 })} />
          ) : (
            <DataTable
              label={sections ? t('connectPage.routes.sections') : t('connectPage.routes.routes')}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              sort={{ key: state.sort, direction: state.sort === 'name' ? 'asc' : 'desc' }}
              onSort={(key) => change({ sort: key, selected: null })}
              selectedKey={state.selected}
              onRowClick={(row) => change({ selected: row.id })}
            />
          )}
          {total != null ? (
            <p className="meta">{t('connectPage.routes.shown', { count: total })}</p>
          ) : null}
          {more ? <p className="meta">{t('connectPage.routes.more')}</p> : null}
        </Card>
      </div>
      <div id="map-slot" className="pane" aria-label={t('connectPage.activity.map')}>
        <CompareOverlay tracks={compareTracks(set, streams)} />
      </div>
      <div id="routes-detail" className="pane">
        <Card label={t('connectPage.routes.passes')}>
          {state.selected ? (
            sections ? (
              <SectionPane
                session={session}
                id={state.selected}
                set={set}
                onSelect={(ids) => change({ ids })}
              />
            ) : (
              <RoutePane session={session} id={state.selected} />
            )
          ) : (
            <EmptyState
              title={
                sections ? t('connectPage.routes.pickSection') : t('connectPage.routes.pickRoute')
              }
            />
          )}
          <p className="actions">
            {ACTIONS[state.kind].map((action) => (
              <Button key={action} disabled title={t(ON_PHONE)}>
                {t(action)}
              </Button>
            ))}
          </p>
          <p className="meta">{t(ON_PHONE)}</p>
        </Card>
      </div>
    </section>
  );
}

function Facts({ facts }: { facts: [string, string | null][] }) {
  return (
    <dl className="facts">
      {facts
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
    </dl>
  );
}

function RoutePane({ session, id }: { session: Session; id: string }) {
  const { t } = useTranslation();
  const read = useRead<RouteDetail>(
    () => session.read('route.detail', { id }, ROUTE_SLOTS.routeDetail) as Promise<RouteDetail>,
    `route:${id}`
  );
  const detail = read.value;
  if (read.failed) return <ErrorState title={t('connectPage.routes.routeFailed')} />;
  if (!detail) return <Skeleton label={t('connectPage.routes.reading')} />;
  return (
    <>
      <h2>{detail.group?.customName ?? t('connectPage.routes.unnamedRoute')}</h2>
      <Facts
        facts={[
          [t('connectPage.routes.sortActivities'), String(detail.activityCount)],
          [t('connectPage.facts.distance'), km(detail.distanceMeters)],
          [t('connectPage.facts.climbing'), `${Math.round(detail.elevationGainMeters)} m`],
          [
            t('connectPage.routes.excluded'),
            detail.excludedActivityIds.length ? String(detail.excludedActivityIds.length) : null,
          ],
        ]}
      />
      <RoutePerformance session={session} id={id} />
    </>
  );
}

const PLOT_WIDTH = 400;
const PLOT_HEIGHT = 160;

/** Speed against date, one point per attempt, the best marked. */
function PerformanceChart({ performance }: { performance: Performance }) {
  const { t } = useTranslation();
  const points = chartPointsOf(performance.chartData.points, PLOT_WIDTH, PLOT_HEIGHT);
  if (points.length === 0) return <p className="meta">{t('connectPage.routes.noAttempts')}</p>;
  return (
    <svg
      className="performance-chart"
      viewBox={`-8 -8 ${PLOT_WIDTH + 16} ${PLOT_HEIGHT + 16}`}
      role="img"
      aria-label={t('connectPage.routes.performanceChart')}
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

/** The attempts table: a column head orders it, a row opens the activity. */
function AttemptsTable({ rows }: { rows: Attempt[] }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<AttemptOrder>({
    column: 'date',
    descending: true,
  });
  const labels: Record<AttemptColumn, string> = {
    date: t('connectPage.strength.colDate'),
    time: t('connectPage.facts.time'),
    speed: t('connectPage.routes.speed'),
  };
  return (
    <table className="attempts">
      <thead>
        <tr>
          {ATTEMPT_COLUMNS.map((column) => (
            <th
              key={column}
              scope="col"
              aria-sort={
                order.column === column ? (order.descending ? 'descending' : 'ascending') : 'none'
              }
            >
              <button type="button" onClick={() => setOrder(pressedAttempts(order, column))}>
                {labels[column]}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {attemptsOf(rows, order).map((row) => (
          <tr key={row.activityId} data-pr={row.isBest}>
            <td>
              <a href={`#/activity/${encodeURIComponent(row.activityId)}`}>
                {new Date(row.date * 1000).toISOString().slice(0, 10)}
              </a>
            </td>
            <td>{clock(row.movingTime)}</td>
            <td>{kmh(row.speed)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RoutePerformance({ session, id }: { session: Session; id: string }) {
  const { t } = useTranslation();
  const performance = useRead<Performance>(
    () =>
      session.read(
        'route.performance',
        performanceAsk(id, RANGE_DAYS),
        ROUTE_SLOTS.routePerformance
      ) as Promise<Performance>,
    `route.performance:${id}`
  );
  const attempts = useRead<RouteAttempts>(
    () =>
      session.read(
        'route.attempts',
        { id, currentActivityId: null, sportTypeFilter: null },
        ROUTE_SLOTS.routeAttempts
      ) as Promise<RouteAttempts>,
    `route.attempts:${id}`
  );
  const best = attempts.value?.best?.activityId;
  const rows: Attempt[] = (attempts.value?.performances ?? []).map((p) => ({
    activityId: p.activityId,
    name: p.name,
    date: p.date,
    speed: p.speed,
    movingTime: p.movingTime,
    isBest: p.activityId === best,
  }));
  return (
    <>
      {performance.failed || attempts.failed ? (
        <p className="notice">{t('connectPage.routes.performanceFailed')}</p>
      ) : null}
      {performance.value ? <PerformanceChart performance={performance.value} /> : null}
      {attempts.value ? <AttemptsTable rows={rows} /> : null}
    </>
  );
}

function SectionPane({
  session,
  id,
  set,
  onSelect,
}: {
  session: Session;
  id: string;
  set: readonly Compared[];
  onSelect: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<PassOrder>({
    column: 'date',
    descending: true,
  });
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const read = useRead<SectionDetail>(
    () =>
      session.read('section.detail', { id }, ROUTE_SLOTS.sectionDetail) as Promise<SectionDetail>,
    `section:${id}`
  );
  const detail = read.value;
  if (read.failed) return <ErrorState title={t('connectPage.routes.sectionFailed')} />;
  if (!detail) return <Skeleton label={t('connectPage.routes.reading')} />;
  const section = detail.section;
  const table = passes(detail.activityRows, order);
  const dateOf = (startTime: number) => new Date(startTime * 1000).toISOString().slice(0, 10);
  const rows: PassTableRow[] = table.map((pass) => ({
    id: pass.activityId,
    elapsed: pass.movingTime,
    pr: pass.pr,
    label: (
      <a
        href={`#/activity/${encodeURIComponent(pass.activityId)}`}
        onClick={(event) => {
          // A plain click opens the activity; a modified one selects the row, as it does on the table.
          if (event.shiftKey || event.ctrlKey || event.metaKey) event.preventDefault();
          else event.stopPropagation();
        }}
      >
        {dateOf(pass.startTime)}
      </a>
    ),
    cells: [
      <>
        {clock(pass.movingTime)}
        {pass.pr ? ` ${t('connectPage.routes.pr')}` : ''}
      </>,
      pass.pr ? '' : `+${pass.delta} s`,
    ],
  }));
  const head = (column: PassColumn, label: string) => (
    <th scope="col">
      <button type="button" onClick={() => setOrder(pressed(order, column))}>
        {label}
        {order.column === column ? (order.descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  const names = dropped.map((dropId) => {
    const row = detail.activityRows.find((candidate) => candidate.activityId === dropId);
    return row ? dateOf(row.startTime) : dropId;
  });
  return (
    <>
      <h2>{section?.name ?? t('connectPage.routes.unnamedSection')}</h2>
      <Facts
        facts={[
          [t('connectPage.routes.passes'), String(detail.activityCount)],
          [t('connectPage.facts.distance'), km(section?.distanceMeters)],
          [t('connectPage.routes.type'), section?.sectionType ?? null],
        ]}
      />
      <SectionChart session={session} id={id} />
      {names.length > 0 ? (
        <p className="meta" role="status">
          {t('connectPage.compare.dropped', { names: names.join(', ') })}
        </p>
      ) : null}
      <PassTable
        rows={rows}
        set={set}
        anchor={anchor}
        head={
          <>
            {head('date', t('connectPage.strength.colDate'))}
            {head('time', t('connectPage.facts.time'))}
            {head('delta', t('connectPage.routes.behindPr'))}
          </>
        }
        onSelect={(ids, gone, picked) => {
          setAnchor(picked);
          setDropped(gone);
          onSelect(ids);
        }}
      />
      <SectionHistoryPane session={session} id={id} />
      <details>
        <summary>
          {t('connectPage.routes.mergeCandidates', {
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

function SectionChart({ session, id }: { session: Session; id: string }) {
  const performance = useRead<Performance>(
    () =>
      session.read(
        'section.performance',
        performanceAsk(id, RANGE_DAYS),
        ROUTE_SLOTS.sectionPerformance
      ) as Promise<Performance>,
    `section.performance:${id}`
  );
  return performance.value ? <PerformanceChart performance={performance.value} /> : null;
}

/** The change ledger, oldest first, and the stored geometry versions. */
function SectionHistoryPane({ session, id }: { session: Session; id: string }) {
  const { t } = useTranslation();
  const read = useRead<SectionHistory>(
    () =>
      session.read(
        'section.history',
        { id },
        ROUTE_SLOTS.sectionHistory
      ) as Promise<SectionHistory>,
    `section.history:${id}`
  );
  if (read.failed) return <p className="notice">{t('connectPage.routes.historyFailed')}</p>;
  if (!read.value) return null;
  const rows = historyRowsOf(read.value);
  return (
    <>
      <details open>
        <summary>{t('connectPage.routes.history', { n: rows.length })}</summary>
        <ol className="history">
          {rows.map((row) => (
            <li key={row.id} data-pinned={row.pinned}>
              <time dateTime={row.at}>{row.at.slice(0, 10)}</time> {row.kind}
              {row.version !== null
                ? ` · ${t('connectPage.routes.version', { n: row.version })}`
                : ''}
              {row.activities.length ? ` · ${row.activities.join(', ')}` : ''}
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>
          {t('connectPage.routes.geometryVersions', {
            n: read.value.geometryVersions.length,
          })}
        </summary>
        <ul>
          {read.value.geometryVersions.map((version) => (
            <li key={version.version} data-pinned={version.pinned}>
              {t('connectPage.routes.version', { n: version.version })} ·{' '}
              {version.createdAt.slice(0, 10)}
              {version.pinned ? ` · ${t('connectPage.routes.pinned')}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
