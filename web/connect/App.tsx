// The connect page's screens. Each reads the session's snapshot and the
// address; nothing here talks to the phone.

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ActivityPage } from './ActivityPage';
import { compareColour, compareRows, select, type Mode } from './compare';
import { clock, km, kmh } from './format';
import type { SportFamily, State } from './link';
import { toQR } from './qr';
import { ON_THE_PHONE, PANE_NOTE, SETTINGS_GROUPS, pane, type Pane } from './settings';
import {
  FEED,
  keyAction,
  parse,
  queryValue,
  resolve,
  tabOf,
  write,
  type Route,
  type Tab,
} from './router';
import type { Card, Detail, Session, Sparklines, Summary } from './session';
import {
  COLUMNS,
  RANGES,
  RANGE_LABELS,
  feedQuery,
  rangeBounds,
  readFeedQuery,
  selectionAfter,
  sortRows,
  type ColumnKey,
  type FeedQuery,
  type RangePreset,
  type Sort,
} from './table';

const STATUS: Record<State['name'], string> = {
  unpaired: 'Not linked',
  inviting: 'Waiting for the code to be scanned',
  proving: 'Checking the phone',
  confirming: 'Confirm on your phone',
  waiting: 'Waiting for your phone',
  connecting: 'Connecting',
  connected: 'Connected',
  update: 'Update Veloq on your phone',
};

const UNSUPPORTED = 'This browser cannot link to the phone. Try a current Chrome, Edge or Firefox.';

const NOTICE: Record<'refused' | 'declined', string> = {
  refused: 'The phone refused this browser. Link it again with a new code.',
  declined: 'Linking was declined on the phone.',
};

const SCREEN_NAMES: Record<Tab, string> = {
  feed: 'Feed',
  fitness: 'Fitness',
  insights: 'Insights',
  map: 'Map',
  settings: 'Settings',
};

const RAIL: { tab: Tab; icon: string }[] = [
  { tab: 'feed', icon: 'F' },
  { tab: 'fitness', icon: 'Fi' },
  { tab: 'insights', icon: 'I' },
  { tab: 'map', icon: 'M' },
  { tab: 'settings', icon: 'S' },
];

const FAMILIES: [family: SportFamily, label: string][] = [
  ['ride', 'Ride'],
  ['run', 'Run'],
  ['winter', 'Winter'],
  ['water', 'Water'],
  ['foot', 'Foot'],
  ['strength', 'Strength'],
  ['other', 'Other'],
];

/** How long typing pauses before the search is asked of the phone. */
const SEARCH_PAUSE_MS = 250;

/** How long the pointer rests on a row before the detail pane previews it. */
const PREVIEW_DELAY_MS = 300;

const PAIRING = new Set<State['name']>(['unpaired', 'inviting', 'proving', 'confirming']);

function subscribeToHash(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** Point the address at a route; the hash change redraws. */
function go(route: Route) {
  location.hash = write(route);
}

/** True when a key press landed on something that handles Enter itself. */
function isControl(target: EventTarget | null) {
  const tag = (target as HTMLElement | null)?.tagName?.toUpperCase();
  return tag === 'BUTTON' || tag === 'A';
}

/** The activity the route opens: `#/activity/<id>`, or `id` on the feed. */
function openedId(route: Route): string | null {
  if (route.screen === 'activity') return route.id;
  return route.screen === 'feed' ? queryValue(route, 'id') : null;
}

export function App({ session }: { session: Session }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.get);
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const [search, setSearch] = useState(snapshot.filter.needle);
  const [keysOpen, setKeysOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { state } = snapshot;
  const connected = state.name === 'connected';
  const pairing = PAIRING.has(state.name);
  const route = resolve(state.name, hash, null).shown ?? FEED;
  const tab = tabOf(route);
  const onFeed = connected && route.screen === 'feed';
  const onActivity = connected && route.screen === 'activity';
  const pinnedId = onFeed || onActivity ? openedId(route) : null;
  const shownId = onFeed && previewId ? previewId : pinnedId;
  const feedState = readFeedQuery(route);
  const familiesKey = feedState.families.join(',');

  useEffect(() => {
    document.body.classList.toggle('shell', connected);
  }, [connected]);

  useEffect(() => {
    if (shownId) session.requestDetail(shownId);
  }, [session, shownId, state]);

  const comparedKey = onFeed ? feedState.ids.join('\n') : '';
  useEffect(() => {
    if (comparedKey) for (const id of comparedKey.split('\n')) session.requestDetail(id);
  }, [session, comparedKey, state]);

  useEffect(() => {
    if (!onFeed) return;
    const current = session.get().filter;
    const { oldestTs, newestTs } = rangeBounds(feedState.range, new Date());
    const families = familiesKey ? (familiesKey.split(',') as SportFamily[]) : [];
    if (
      current.families.join(',') === familiesKey &&
      (current.oldestTs ?? null) === oldestTs &&
      (current.newestTs ?? null) === newestTs
    ) {
      return;
    }
    session.setFilter({ ...current, families, oldestTs, newestTs });
  }, [session, onFeed, familiesKey, feedState.range]);

  const needle = search.trim();
  useEffect(() => {
    if (needle === session.get().filter.needle) return undefined;
    const typing = setTimeout(
      () => session.setFilter({ ...session.get().filter, needle }),
      SEARCH_PAUSE_MS
    );
    return () => clearTimeout(typing);
  }, [session, needle]);

  const libraryOpen = onFeed || onActivity;
  useEffect(() => {
    if (!connected) return undefined;
    function onKey(event: KeyboardEvent) {
      const action = keyAction({
        key: event.key,
        target: event.target as HTMLElement | null,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });
      if (!action) return;
      if (action.do === 'tab') {
        event.preventDefault();
        go({ screen: action.tab, id: null, query: [] });
      } else if (action.do === 'search') {
        if (libraryOpen) {
          event.preventDefault();
          document.getElementById('search')?.focus();
        }
      } else if (action.do === 'step' || action.do === 'open') {
        const current = parse(location.hash);
        if (current.screen !== 'feed') return;
        const state = readFeedQuery(current);
        if (action.do === 'step') {
          const ids = sortRows(session.get().feed ?? [], state.sort).map((row) => row.id);
          const id = selectionAfter(ids, state.id, action.step);
          if (id === null) return;
          event.preventDefault();
          go({ ...current, query: feedQuery({ ...state, id, ids: [] }) });
          document
            .querySelector(`[data-row="${CSS.escape(id)}"]`)
            ?.scrollIntoView?.({ block: 'nearest' });
        } else if (state.id && !isControl(event.target)) {
          event.preventDefault();
          go({ screen: 'activity', id: state.id, query: [] });
        }
      } else if (action.do === 'closeDetail') {
        const current = parse(location.hash);
        if (current.screen === 'activity') go(FEED);
        else if (readFeedQuery(current).ids.length > 0) {
          go({ ...current, query: current.query.filter(([key]) => key !== 'ids') });
        } else go({ ...current, query: current.query.filter(([key]) => key !== 'id') });
      } else {
        setKeysOpen((open) => !open);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      setKeysOpen(false);
    };
  }, [session, connected, libraryOpen]);

  return (
    <>
      <header>
        <h1>Veloq</h1>
        <p id="status" role="status" aria-live="polite">
          {snapshot.failed ? UNSUPPORTED : STATUS[state.name]}
        </p>
      </header>

      {connected ? (
        <nav id="rail" aria-label="Screens">
          <ul>
            {RAIL.map((entry) => (
              <li key={entry.tab}>
                <a href={`#/${entry.tab}`} data-tab={entry.tab} aria-current={entry.tab === tab}>
                  <span className="icon" aria-hidden="true">
                    {entry.icon}
                  </span>
                  <span className="label">{SCREEN_NAMES[entry.tab]}</span>
                </a>
              </li>
            ))}
          </ul>
          {libraryOpen ? (
            <input
              id="search"
              type="search"
              placeholder="Search (/)"
              aria-label="Search activities"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          ) : null}
          <p className="phone">Your phone</p>
        </nav>
      ) : null}

      <main>
        {pairing ? <PairPane state={state} code={snapshot.code} /> : null}
        {snapshot.writeNotice ? (
          <p id="write-notice" className="notice" role="status">
            {snapshot.writeNotice}
          </p>
        ) : null}
        {(state.name === 'waiting' || state.name === 'connecting') && <WaitingPane />}
        {state.name === 'update' && <UpdatePane />}
        {onActivity && route.id ? (
          <ActivityPage
            id={route.id}
            card={snapshot.feed?.find((row) => row.id === route.id)}
            detail={snapshot.details[route.id]}
            data={null}
          />
        ) : null}
        {onFeed ? (
          <Library
            cards={snapshot.feed ?? []}
            more={snapshot.feedMore}
            summary={snapshot.summary}
            sparklines={snapshot.sparklines}
            highlights={snapshot.highlights}
            onMore={session.loadMore}
            detail={shownId ? snapshot.details[shownId] : undefined}
            shownId={shownId}
            route={route}
            query={feedState}
            onPreview={setPreviewId}
            details={snapshot.details}
          />
        ) : null}
        {connected && route.screen === 'settings' ? <SettingsPane id={route.id} /> : null}
        {connected && !onFeed && !onActivity && route.screen !== 'settings' ? (
          <section id="later">
            <h2 id="later-title">{SCREEN_NAMES[tab]}</h2>
            <p>This screen is not on the browser yet. Open it on your phone.</p>
          </section>
        ) : null}
        {connected && keysOpen ? <KeysPane /> : null}
      </main>

      <footer>
        <p>
          Your data goes straight from your phone to this page and is kept only while it is open.
        </p>
        {!pairing && (
          <button id="forget" type="button" onClick={session.unlink}>
            Unlink this browser
          </button>
        )}
      </footer>
    </>
  );
}

function PairPane({ state, code }: { state: State; code: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (code && canvas.current) drawCode(canvas.current, code);
  }, [code]);
  const notice = state.name === 'unpaired' || state.name === 'inviting' ? state.notice : undefined;
  return (
    <section id="pair">
      <h2>Link this browser</h2>
      <ol>
        <li>Open Veloq on your phone.</li>
        <li>Go to Settings, then Linked devices, then Link a device.</li>
        <li>Scan this code.</li>
      </ol>
      <canvas ref={canvas} id="code" width={360} height={360} aria-label="Link code" />
      {notice ? (
        <p id="pair-notice" className="notice">
          {NOTICE[notice]}
        </p>
      ) : null}
    </section>
  );
}

function drawCode(canvas: HTMLCanvasElement, text: string) {
  const modules = toQR(text);
  const size = Math.sqrt(modules.length);
  const quiet = 4;
  const scale = Math.floor(canvas.width / (size + quiet * 2));
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  const offset = Math.floor((canvas.width - size * scale) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x])
        context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
    }
  }
}

function WaitingPane() {
  return (
    <section id="waiting">
      <h2>Waiting for your phone</h2>
      <p>
        Open Veloq on your phone. This page connects on its own, on the same Wi-Fi or across
        networks.
      </p>
    </section>
  );
}

function UpdatePane() {
  return (
    <section id="update">
      <h2>Update Veloq on your phone</h2>
      <p>
        This page and the Veloq on your phone do not speak the same version of the link. Update
        Veloq on your phone, then open this page again.
      </p>
    </section>
  );
}

function KeysPane() {
  return (
    <section id="keys">
      <h2>Keys</h2>
      <dl>
        <dt>1 to 5</dt>
        <dd>Feed, Fitness, Insights, Map, Settings</dd>
        <dt>/</dt>
        <dd>Search the feed</dd>
        <dt>Esc</dt>
        <dd>Close the activity</dd>
        <dt>?</dt>
        <dd>This list</dd>
      </dl>
    </section>
  );
}

/** The phone's settings hub as a list on the left and the chosen screen on the right. */
function SettingsPane({ id }: { id: string | null }) {
  return (
    <section id="settings">
      <nav id="settings-list" aria-label="Settings">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title} className="settings-group">
            <h2>{group.title}</h2>
            <ul>
              {group.rows.map((row) => (
                <li key={row.screen}>
                  <a href={`#/settings/${row.screen}`} aria-current={id === row.screen}>
                    {row.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="settings-group">
          <h2>On the phone</h2>
          <ul>
            {ON_THE_PHONE.map((entry) => (
              <li key={entry.title}>
                {entry.screen ? (
                  <a href={`#/settings/${entry.screen}`} aria-current={id === entry.screen}>
                    {entry.title}
                  </a>
                ) : (
                  entry.title
                )}
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div id="settings-pane">
        <SettingsBody shown={pane(id)} />
      </div>
    </section>
  );
}

function SettingsBody({ shown }: { shown: Pane }) {
  if (shown.kind === 'readable') {
    return (
      <>
        <h2 id="settings-title">{shown.title}</h2>
        <p className="note">{shown.note}</p>
        <p>{shown.body}</p>
      </>
    );
  }
  if (shown.kind === 'phone') {
    return (
      <>
        <h2 id="settings-title">{shown.title}</h2>
        <p>{shown.why}</p>
        <p className="note">Open it on your phone.</p>
      </>
    );
  }
  if (shown.kind === 'unknown') {
    return (
      <>
        <h2 id="settings-title">Not on the browser yet</h2>
        <p>This setting is not on the browser yet. Open it on your phone.</p>
      </>
    );
  }
  return (
    <>
      <h2 id="settings-title">Pick a setting</h2>
      <p className="note">{PANE_NOTE}</p>
    </>
  );
}

function Library(props: {
  cards: Card[];
  more: boolean;
  summary: Summary | null;
  sparklines: Sparklines | null;
  highlights: Readonly<Record<string, string[]>>;
  onMore: () => void;
  detail: Detail | undefined;
  shownId: string | null;
  route: Route;
  query: FeedQuery;
  onPreview: (id: string | null) => void;
  details: Readonly<Record<string, Detail | undefined>>;
}) {
  const [dropped, setDropped] = useState<string[]>([]);
  const compared = props.query.ids
    .map((id) => props.cards.find((row) => row.id === id))
    .filter((row): row is Card => row !== undefined);
  const comparing = compared.length >= 2;
  const card = props.cards.find((row) => row.id === props.shownId);
  const rows = sortRows(props.cards, props.query.sort);
  return (
    <section id="library">
      <div id="list-pane">
        {props.summary ? <SummaryCard card={props.summary} lines={props.sparklines} /> : null}
        <h2>Activities</h2>
        <RangeChips query={props.query} />
        <FamilyChips query={props.query} />
        {props.query.sort && props.more ? (
          <p id="sort-note" role="note">
            Sorted over the {props.cards.length} activities loaded so far; more load as you scroll.
          </p>
        ) : null}
        <FeedTable
          rows={rows}
          highlights={props.highlights}
          query={props.query}
          onPreview={props.onPreview}
          onDropped={setDropped}
        />
        {props.more ? <MoreButton onMore={props.onMore} /> : null}
      </div>
      <div id="detail-pane">
        {comparing ? (
          <CompareTable
            cards={compared}
            details={props.details}
            dropped={props.cards.filter((row) => dropped.includes(row.id)).map((row) => row.name)}
          />
        ) : (
          <>
            <h2 id="detail-title">{card ? card.name : 'Pick an activity'}</h2>
            <DetailFacts card={card} detail={props.detail} />
          </>
        )}
      </div>
    </section>
  );
}

/** Point the feed at a state, keeping the screen. */
function goFeed(query: FeedQuery) {
  go({ screen: 'feed', id: null, query: feedQuery(query) });
}

/** The week's totals, the wellness headlines and the fitness line above the list. */
function SummaryCard({ card, lines }: { card: Summary; lines: Sparklines | null }) {
  const { wellness } = card;
  const facts: [label: string, value: string | null][] = [
    [
      'This week',
      `${clock(card.currentWeek.totalDuration)} · ${card.currentWeek.count} activities`,
    ],
    ['Last week', `${clock(card.prevWeek.totalDuration)} · ${card.prevWeek.count} activities`],
    ['Fitness', wellness.fitness == null ? null : String(Math.round(wellness.fitness))],
    ['Form', wellness.form == null ? null : String(Math.round(wellness.form))],
    ['HRV', wellness.hrv == null ? null : String(Math.round(wellness.hrv))],
    ['Resting heart rate', wellness.rhr == null ? null : `${Math.round(wellness.rhr)} bpm`],
  ];
  return (
    <section id="summary">
      <h2>Summary</h2>
      <dl id="summary-facts">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
      </dl>
      <svg
        id="summary-spark"
        viewBox="0 0 120 32"
        role="img"
        aria-label="Fitness over the last 30 days"
      >
        <polyline
          id="summary-line"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={sparkPoints(lines?.fitness ?? [])}
        />
      </svg>
    </section>
  );
}

/** An SVG polyline's points for a series, scaled into a 120 by 32 box. */
function sparkPoints(series: readonly number[]) {
  if (series.length < 2) return '';
  const low = Math.min(...series);
  const span = Math.max(...series) - low || 1;
  return series
    .map(
      (v, at) =>
        `${((at / (series.length - 1)) * 120).toFixed(1)},${(32 - ((v - low) / span) * 32).toFixed(1)}`
    )
    .join(' ');
}

/** The range presets; the chosen one is pressed, and pressing it again clears it. */
function RangeChips({ query }: { query: FeedQuery }) {
  return (
    <div id="ranges" role="group" aria-label="Range">
      {RANGES.map((preset: RangePreset) => {
        const on = query.range === preset;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={on}
            onClick={() => goFeed({ ...query, range: on ? null : preset })}
          >
            {RANGE_LABELS[preset]}
          </button>
        );
      })}
    </div>
  );
}

/** The sport chips under the heading; each narrows the feed to its family. */
function FamilyChips({ query }: { query: FeedQuery }) {
  return (
    <div id="families" role="group" aria-label="Sport">
      {FAMILIES.map(([family, label]) => {
        const on = query.families.includes(family);
        return (
          <button
            key={family}
            type="button"
            aria-pressed={on}
            onClick={() =>
              goFeed({
                ...query,
                families: on
                  ? query.families.filter((held) => held !== family)
                  : [...query.families, family],
              })
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Reads the next page when clicked or when it scrolls into view. */
function MoreButton({ onMore }: { onMore: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = button.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) onMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMore]);
  return (
    <button ref={button} id="feed-more" type="button" onClick={onMore}>
      Load more
    </button>
  );
}

/** The next sort when a header is pressed: ascending, descending, then none. */
function nextSort(sort: Sort | null, column: ColumnKey): Sort | null {
  if (sort?.column !== column) return { column, dir: 'asc' };
  return sort.dir === 'asc' ? { column, dir: 'desc' } : null;
}

const cell = (card: Card, key: ColumnKey): string | null => {
  switch (key) {
    case 'date':
      return String(card.startDateLocal ?? '').slice(0, 10) || null;
    case 'sport':
      return card.sportType ?? null;
    case 'distance':
      return km(card.distance);
    case 'time':
      return clock(card.movingTime);
    case 'climb':
      return card.elevationGain == null ? null : `${Math.round(card.elevationGain)} m`;
    case 'load':
      return card.trainingLoad == null ? null : String(Math.round(card.trainingLoad));
    case 'hr':
      return card.avgHr == null ? null : String(Math.round(card.avgHr));
    case 'power':
      return card.avgPower == null ? null : String(Math.round(card.avgPower));
    default:
      return card.name;
  }
};

function FeedTable({
  rows,
  highlights,
  query,
  onPreview,
  onDropped,
}: {
  rows: Card[];
  highlights: Readonly<Record<string, string[]>>;
  query: FeedQuery;
  onPreview: (id: string | null) => void;
  onDropped: (ids: string[]) => void;
}) {
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(hover.current);
      onPreview(null);
    },
    [onPreview]
  );
  return (
    <div id="feed-scroll">
      <table id="feed">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const sorted = query.sort?.column === column.key ? query.sort.dir : null;
              return (
                <th
                  key={column.key}
                  className={column.numeric ? 'num' : undefined}
                  aria-sort={
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => goFeed({ ...query, sort: nextSort(query.sort, column.key) })}
                  >
                    {column.label}
                    {sorted ? (sorted === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((card) => (
            <tr
              key={card.id}
              data-row={card.id}
              aria-selected={card.id === query.id || query.ids.includes(card.id)}
              onClick={(event) => {
                clearTimeout(hover.current);
                onPreview(null);
                const mode: Mode = event.shiftKey
                  ? 'range'
                  : event.ctrlKey || event.metaKey
                    ? 'toggle'
                    : 'single';
                if (mode === 'single') {
                  onDropped([]);
                  goFeed({ ...query, id: card.id, ids: [] });
                  return;
                }
                const next = select(
                  { ids: query.ids, anchor: query.id ?? query.ids[0] ?? null },
                  rows.map((row) => row.id),
                  card.id,
                  mode
                );
                onDropped(next.dropped);
                goFeed(
                  next.ids.length >= 2
                    ? { ...query, ids: next.ids, id: query.id ?? next.ids[0] ?? null }
                    : { ...query, ids: [], id: next.ids[0] ?? query.id }
                );
              }}
              onMouseEnter={() => {
                clearTimeout(hover.current);
                hover.current = setTimeout(() => onPreview(card.id), PREVIEW_DELAY_MS);
              }}
              onMouseLeave={() => {
                clearTimeout(hover.current);
                onPreview(null);
              }}
            >
              {COLUMNS.map((column) =>
                column.key === 'name' ? (
                  <td key="name">
                    <button type="button" className="name">
                      {card.name}
                    </button>
                    {highlights[card.id]?.length ? (
                      <span className="chips">
                        {(highlights[card.id] ?? []).map((label, at) => (
                          <span key={at} className="chip">
                            {label}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </td>
                ) : (
                  <td key={column.key} className={column.numeric ? 'num' : undefined}>
                    {cell(card, column.key)}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One column per compared activity, the best value in each row marked. */
function CompareTable(props: {
  cards: Card[];
  details: Readonly<Record<string, Detail | undefined>>;
  dropped: string[];
}) {
  const rows = compareRows(props.cards, props.details);
  return (
    <section id="compare">
      <h2 id="detail-title">Comparing {props.cards.length} activities</h2>
      {props.dropped.length ? (
        <p id="compare-note" role="status">
          Four activities at most: {props.dropped.join(', ')} was dropped.
        </p>
      ) : null}
      <table id="compare-table">
        <thead>
          <tr>
            <td />
            {props.cards.map((card, at) => (
              <th key={card.id} scope="col" className={`compare-${compareColour(at)}`}>
                {card.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, at) => (
                <td key={at} data-best={cell.best}>
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DetailFacts({ card, detail }: { card: Card | undefined; detail: Detail | undefined }) {
  const facts: [label: string, value: string | null][] =
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
          [
            'Training load',
            card.trainingLoad == null ? null : String(Math.round(card.trainingLoad)),
          ],
        ]
      : [];
  return (
    <dl id="detail">
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
