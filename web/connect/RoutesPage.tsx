// The routes and sections pages: the list on the left, a slot for the map in
// the centre and the selected row's detail on the right. The list is the
// engine's own read for the sort, search and chips in the address; nothing
// here orders or counts what the engine did.

import type { ParseKeys } from 'i18next';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clock, km } from './format';
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
import { write, type Route } from './router';
import type { Session } from './session';
import type { Methods } from './schema';

type Screen = Methods['routes.screen']['result'];
type RouteDetail = Methods['route.detail']['result'];
type SectionDetail = Methods['section.detail']['result'];

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
  const [held, setHeld] = useState<{ key: string; value: T | null; failed: boolean }>({
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

export function RoutesPage({ session, route }: { session: Session; route: Route }) {
  const { t } = useTranslation();
  const state = fromRoute(route);
  const [text, setText] = useState(state?.search ?? '');
  const [hovered, setHovered] = useState<string | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const sections = state?.kind === 'sections';

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
    state ? () => session.read('routes.screen', queryFor(state)) as Promise<Screen> : null,
    listKey
  );

  if (!state) return null;
  const change = (next: Partial<ListState>) => go(toRoute({ ...state, ...next }));
  const rows = sections
    ? (list.value?.sections ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? t('connectPage.routes.unnamedSection'),
        meta: [
          km(row.distanceMeters),
          t('connectPage.routes.visits', { count: row.visitCount }),
          row.sportTypes.join(', '),
        ],
      }))
    : (list.value?.groups ?? []).map((row) => ({
        id: row.groupId,
        name: row.customName ?? t('connectPage.routes.unnamedRoute'),
        meta: [
          km(row.distanceMeters),
          t('connectPage.routes.activities', { count: row.activityCount }),
          row.sportTypes.join(', '),
        ],
      }));
  const total = sections ? list.value?.filteredSectionCount : list.value?.filteredGroupCount;
  const more = sections ? list.value?.hasMoreSections : list.value?.hasMoreGroups;

  return (
    <section id="routes-page" data-kind={state.kind}>
      <div id="routes-list" className="pane">
        <h2>{sections ? t('connectPage.routes.sections') : t('connectPage.routes.routes')}</h2>
        <nav className="tabs" aria-label={t('connectPage.routes.kinds')}>
          <a href="#/routes" aria-current={!sections}>
            {t('connectPage.routes.routes')}
          </a>
          <a href="#/sections" aria-current={sections}>
            {t('connectPage.routes.sections')}
          </a>
        </nav>
        <input
          id="search"
          type="search"
          placeholder={t('connectPage.routes.searchHint')}
          aria-label={
            sections ? t('connectPage.routes.searchSections') : t('connectPage.routes.searchRoutes')
          }
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <label>
          {t('connectPage.routes.sort')}{' '}
          <select
            id="sort"
            value={state.sort}
            onChange={(event) => change({ sort: event.target.value, selected: null })}
          >
            {(sections ? SECTION_SORTS : ROUTE_SORTS)
              .filter((sort) => sort !== 'nearby')
              .map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_NAMES[sort] ? t(SORT_NAMES[sort]) : sort}
                </option>
              ))}
          </select>
        </label>
        {sections ? (
          <p className="chips" role="group" aria-label={t('connectPage.routes.show')}>
            {CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip"
                aria-pressed={state.chips.includes(chip)}
                onClick={() => change({ ...toggled(state, chip), selected: null })}
              >
                {t(CHIP_NAMES[chip])}
              </button>
            ))}
          </p>
        ) : null}
        {list.failed ? <p className="notice">{t('connectPage.routes.listFailed')}</p> : null}
        {total != null ? (
          <p className="meta">{t('connectPage.routes.shown', { count: total })}</p>
        ) : null}
        <ul id="rows">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                aria-current={row.id === state.selected}
                data-kept={kept.has(row.id)}
                onMouseEnter={() => setHovered(row.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey) {
                    const next = new Set(kept);
                    if (!next.delete(row.id)) next.add(row.id);
                    setKept(next);
                  } else {
                    change({ selected: row.id });
                  }
                }}
              >
                {row.name}
                <span className="meta">{row.meta.filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
        {more ? <p className="meta">{t('connectPage.routes.more')}</p> : null}
        {kept.size > 0 ? (
          <p className="meta">{t('connectPage.routes.kept', { count: kept.size })}</p>
        ) : null}
      </div>
      <div
        id="map-slot"
        className="pane"
        data-lit={hovered ?? ''}
        aria-label={t('connectPage.activity.map')}
      />
      <div id="routes-detail" className="pane">
        {state.selected ? (
          sections ? (
            <SectionPane session={session} id={state.selected} />
          ) : (
            <RoutePane session={session} id={state.selected} />
          )
        ) : (
          <h2>{sections ? t('connectPage.routes.pickSection') : t('connectPage.routes.pickRoute')}</h2>
        )}
        <p className="actions">
          {ACTIONS[state.kind].map((action) => (
            <button key={action} type="button" disabled title={t(ON_PHONE)}>
              {t(action)}
            </button>
          ))}
        </p>
        <p className="meta">{t(ON_PHONE)}</p>
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
  const read = useRead<RouteDetail>(() => session.read('route.detail', { id }) as Promise<RouteDetail>, `route:${id}`);
  const detail = read.value;
  if (read.failed) return <p className="notice">{t('connectPage.routes.routeFailed')}</p>;
  if (!detail) return <h2>{t('connectPage.routes.reading')}</h2>;
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
    </>
  );
}

function SectionPane({ session, id }: { session: Session; id: string }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<PassOrder>({ column: 'date', descending: true });
  const read = useRead<SectionDetail>(
    () => session.read('section.detail', { id }) as Promise<SectionDetail>,
    `section:${id}`
  );
  const detail = read.value;
  if (read.failed) return <p className="notice">{t('connectPage.routes.sectionFailed')}</p>;
  if (!detail) return <h2>{t('connectPage.routes.reading')}</h2>;
  const section = detail.section;
  const table = passes(detail.activityRows, order);
  const head = (column: PassColumn, label: string) => (
    <th scope="col">
      <button type="button" onClick={() => setOrder(pressed(order, column))}>
        {label}
        {order.column === column ? (order.descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
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
      <table id="passes">
        <thead>
          <tr>
            {head('date', t('connectPage.strength.colDate'))}
            {head('time', t('connectPage.facts.time'))}
            {head('delta', t('connectPage.routes.behindPr'))}
          </tr>
        </thead>
        <tbody>
          {table.map((pass) => (
            <tr key={pass.activityId} data-pr={pass.pr}>
              <td>
                <a href={`#/activity/${encodeURIComponent(pass.activityId)}`}>
                  {new Date(pass.startTime * 1000).toISOString().slice(0, 10)}
                </a>
              </td>
              <td>
                {clock(pass.movingTime)}
                {pass.pr ? ` ${t('connectPage.routes.pr')}` : ''}
              </td>
              <td>{pass.pr ? '' : `+${pass.delta} s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>{t('connectPage.routes.history', { n: detail.history.length })}</summary>
        <ul>
          {detail.history.map((event, at) => (
            <li key={at}>{JSON.stringify(event)}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary>
          {t('connectPage.routes.geometryVersions', { n: detail.geometryVersions.length })}
        </summary>
        <ul>
          {detail.geometryVersions.map((version, at) => (
            <li key={at}>{JSON.stringify(version)}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary>
          {t('connectPage.routes.mergeCandidates', { n: detail.mergeCandidates.length })}
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
