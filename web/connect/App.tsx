// The connect page's screens. Each reads the session's snapshot and the
// address; nothing here talks to the phone.

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { chartDataOf, factsOfDetail } from './activity';
import { ActivityPage } from './ActivityPage';
import { ConnectionChip } from './ConnectionChip';
import { RailGlyph, type RailIcon } from './RailGlyph';
import { waitingKey } from './connection';
import { fitnessChoices, fitnessQuery } from './dashboard';
import { FitnessPane } from './FitnessPane';
import { INSIGHTS_PARTS_KEY, type InsightsParts } from './insights';
import { InsightsPane, parseOpened } from './InsightsPane';
import { LanguageMenu } from './LanguageMenu';
import { compareColour, compareRows, select, type Mode } from './compare';
import { clock, km, kmh, setUnitSystem } from './format';
import { deviceLines, strengthPeriodDays, type Notice, type SportFamily, type State } from './link';
import { MapScreen } from './map/MapScreen';
import { sportMark, THUMB, trackShape } from './preview';
import { toQR } from './qr';
import { SportGlyph } from './SportGlyph';
import {
  Badge,
  Button,
  Card as Surface,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  SearchField,
  SegmentedControl,
  type Column,
} from './ui';
import { RoutesPage } from './RoutesPage';
import { Card as Panel, Select } from './ui';
import {
  ON_THE_PHONE,
  PANE_NOTE,
  SCREEN_SETTINGS,
  SETTINGS_GROUPS,
  pane,
  paneControls,
  readsScreen,
  unitSystem,
  type Pane,
} from './settings';
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
import type { Methods } from './schema';
import {
  activityParts,
  type ActivityParts,
  type Card,
  type Detail,
  type Session,
  type SettingsReads,
  type Sparklines,
  type Summary,
} from './session';
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

const NOTICE: Record<Notice, ParseKeys> = {
  refused: 'connectPage.notice.refused',
  declined: 'connectPage.notice.declined',
  removed: 'connectPage.notice.removed',
  unreachable: 'connectPage.notice.unreachable',
};

const SCREEN_NAMES: Record<Tab, ParseKeys> = {
  feed: 'connectPage.screens.feed',
  fitness: 'connectPage.screens.fitness',
  insights: 'connectPage.screens.insights',
  map: 'connectPage.screens.map',
  settings: 'connectPage.screens.settings',
};

type RailEntry = {
  key: string;
  /** The hash the entry opens. */
  href: string;
  /** The screen that marks it selected; a tab's entry is selected on any screen of the tab no sub-entry names. */
  screen: string | null;
  tab: Tab;
  name: ParseKeys;
  icon: RailIcon;
  /** Set on an entry indented under the one before it. */
  child?: true;
};

/** The five tabs in the phone's order, Routes and Sections indented under Map. */
const RAIL: RailEntry[] = [
  { key: 'feed', href: '#/feed', screen: null, tab: 'feed', name: SCREEN_NAMES.feed, icon: 'feed' },
  {
    key: 'fitness',
    href: '#/fitness',
    screen: null,
    tab: 'fitness',
    name: SCREEN_NAMES.fitness,
    icon: 'fitness',
  },
  {
    key: 'insights',
    href: '#/insights',
    screen: null,
    tab: 'insights',
    name: SCREEN_NAMES.insights,
    icon: 'insights',
  },
  { key: 'map', href: '#/map', screen: null, tab: 'map', name: SCREEN_NAMES.map, icon: 'map' },
  {
    key: 'routes',
    href: '#/routes',
    screen: 'routes',
    tab: 'map',
    name: 'connectPage.activity.routes',
    icon: 'routes',
    child: true,
  },
  {
    key: 'sections',
    href: '#/sections',
    screen: 'sections',
    tab: 'map',
    name: 'connectPage.activity.sections',
    icon: 'sections',
    child: true,
  },
  {
    key: 'settings',
    href: '#/settings',
    screen: null,
    tab: 'settings',
    name: SCREEN_NAMES.settings,
    icon: 'settings',
  },
];

const SUB_SCREENS = new Set(RAIL.flatMap((entry) => (entry.screen ? [entry.screen] : [])));

/** Whether a rail entry is the one the route sits on. */
function railSelected(entry: RailEntry, route: Route, tab: Tab): boolean {
  if (entry.screen) return route.screen === entry.screen;
  return entry.tab === tab && !SUB_SCREENS.has(route.screen);
}

const FAMILIES: [family: SportFamily, label: ParseKeys][] = [
  ['ride', 'connectPage.families.ride'],
  ['run', 'connectPage.families.run'],
  ['winter', 'connectPage.families.winter'],
  ['water', 'connectPage.families.water'],
  ['foot', 'connectPage.families.foot'],
  ['strength', 'connectPage.families.strength'],
  ['other', 'connectPage.families.other'],
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

export function App({
  session,
  onLanguage,
}: {
  session: Session;
  onLanguage: (tag: string) => void;
}) {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(session.subscribe, session.get);
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const [search, setSearch] = useState(snapshot.filter.needle);
  const [keysOpen, setKeysOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { state } = snapshot;
  /** Bumped when the phone says its library changed, so each screen on view asks again. */
  const changes = snapshot.libraryChanges;
  const connected = state.name === 'connected';
  const pairing = PAIRING.has(state.name);
  const route = resolve(state.name, hash, null).shown ?? FEED;
  const tab = tabOf(route);
  const onFeed = connected && route.screen === 'feed';
  const onActivity = connected && route.screen === 'activity';
  const onMap = connected && route.screen === 'map';
  const onFitness = connected && route.screen === 'fitness';
  const onSettings = connected && route.screen === 'settings';
  const onStrength =
    connected && route.screen === 'insights' && queryValue(route, 'type') === 'strength';
  const onInsights = connected && route.screen === 'insights' && !onStrength;
  const onDashboard = onFitness || onInsights;
  const onExercise = connected && route.screen === 'exercise' && route.id !== null;
  const onRecordings = connected && route.screen === 'recordings';
  const onRecording = connected && route.screen === 'recording' && route.id !== null;
  const onRoutes = connected && ['routes', 'route', 'sections', 'section'].includes(route.screen);
  const ownPane =
    onFeed ||
    onActivity ||
    onMap ||
    onSettings ||
    onFitness ||
    onInsights ||
    onStrength ||
    onExercise ||
    onRecordings ||
    onRecording ||
    onRoutes;
  const strengthDays = strengthPeriodDays(queryValue(route, 'period'));
  const exerciseCategory = onExercise ? exerciseOf(route.id) : null;
  const pinnedId = onFeed || onActivity ? openedId(route) : null;
  const shownId = onFeed && previewId ? previewId : pinnedId;
  const feedState = readFeedQuery(route);
  const familiesKey = feedState.families.join(',');

  useEffect(() => {
    document.body.classList.toggle('shell', connected);
  }, [connected]);

  useEffect(() => {
    if (shownId) session.requestDetail(shownId);
  }, [session, shownId, state, changes]);

  const openedActivity = onActivity ? route.id : null;
  useEffect(() => {
    if (openedActivity) session.requestActivityParts(openedActivity);
  }, [session, openedActivity, state, changes]);
  const parts = openedActivity
    ? (snapshot.screens[activityParts(openedActivity)] as ActivityParts | undefined)
    : undefined;

  useEffect(() => {
    if (connected) session.requestSettings();
  }, [session, connected, state, changes]);

  const phoneSettings = snapshot.settings['settings.get']?.values;
  setUnitSystem(
    unitSystem(
      phoneSettings?.find((entry) => entry.key === 'veloq-unit-preference')?.value,
      snapshot.settings['settings.profile']?.measurementPreference
    )
  );

  useEffect(() => {
    if (onDashboard) session.requestInsights();
  }, [session, onDashboard, state, changes]);

  useEffect(() => {
    if (onInsights && snapshot.screens[INSIGHTS_PARTS_KEY] !== undefined) {
      document.getElementById('insights-page')?.scrollIntoView();
    }
  }, [onInsights, snapshot.screens]);

  useEffect(() => {
    if (onStrength) session.requestStrength(strengthDays);
    if (exerciseCategory !== null) {
      session.request(`exercise:${exerciseCategory}`, 'strength.exercise', { exerciseCategory });
    }
    if (onRecordings) session.request('recordings', 'recordings.list', {});
    if (onRecording && route.id !== null) {
      session.request(`recording:${route.id}`, 'recordings.get', { id: route.id });
    }
  }, [
    session,
    state,
    changes,
    onStrength,
    strengthDays,
    exerciseCategory,
    onRecordings,
    onRecording,
    route.id,
  ]);

  const choices = fitnessChoices(route);
  useEffect(() => {
    if (!onDashboard) return;
    session.requestFitness();
    session.setFitnessRange(choices.range);
    session.setFitnessSport(choices.sport);
  }, [session, onDashboard, state, changes, choices.range, choices.sport]);

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
      <header id="topbar">
        <h1>{connected ? t(SCREEN_NAMES[tab]) : 'Veloq'}</h1>
        <ConnectionChip
          session={session}
          state={state}
          failed={snapshot.failed}
          since={snapshot.connectedSince}
        />
        <LanguageMenu onChange={onLanguage} />
      </header>

      {connected ? (
        <nav id="rail" aria-label={t('connectPage.railLabel')}>
          <p className="brand" aria-hidden="true">
            Veloq
          </p>
          <ul>
            {RAIL.map((entry) => {
              const selected = railSelected(entry, route, tab);
              return (
                <li key={entry.key} className={entry.child ? 'child' : undefined}>
                  <a
                    href={entry.href}
                    data-tab={entry.key}
                    aria-current={selected ? 'page' : undefined}
                  >
                    <RailGlyph icon={entry.icon} selected={selected} />
                    <span className="label">{t(entry.name)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="phone">
            {state.name === 'connected' && state.device ? state.device : t('connectPage.yourPhone')}
          </p>
        </nav>
      ) : null}

      <main>
        {snapshot.failed ? (
          <p className="notice" role="status">
            {t('connectPage.unsupported')}
          </p>
        ) : null}
        {pairing ? <PairPane state={state} code={snapshot.code} /> : null}
        {snapshot.writeNotice ? (
          <p id="write-notice" className="notice" role="status">
            {t(snapshot.writeNotice)}
          </p>
        ) : null}
        {(state.name === 'waiting' || state.name === 'connecting') && <WaitingPane state={state} />}
        {state.name === 'update' && <UpdatePane />}
        {onActivity && route.id ? (
          <ActivityPage
            id={route.id}
            card={snapshot.feed?.find((row) => row.id === route.id)}
            detail={snapshot.details[route.id]}
            data={chartDataOf(parts?.streams)}
            facts={factsOfDetail(parts?.laps, parts?.data, route.id)}
            read={session.read}
            revision={changes}
          />
        ) : null}
        {onFeed ? (
          <Library
            cards={snapshot.feed ?? []}
            more={snapshot.feedMore}
            summary={snapshot.summary}
            sparklines={snapshot.sparklines}
            highlights={snapshot.highlights}
            previews={snapshot.previews}
            onMore={session.loadMore}
            detail={shownId ? snapshot.details[shownId] : undefined}
            shownId={shownId}
            route={route}
            query={feedState}
            search={search}
            onSearch={setSearch}
            onPreview={setPreviewId}
            details={snapshot.details}
          />
        ) : null}
        {onRoutes ? <RoutesPage session={session} route={route} /> : null}
        {onMap ? (
          <MapScreen
            read={session.read}
            methods={state.name === 'connected' ? (state.methods ?? []) : []}
            route={route}
          />
        ) : null}
        {onSettings ? <SettingsPane id={route.id} reads={snapshot.settings} /> : null}
        {onStrength ? (
          <StrengthPane
            days={strengthDays}
            screen={
              snapshot.screens[`strength:${strengthDays}`] as
                Methods['strength.screen']['result'] | undefined
            }
          />
        ) : null}
        {onExercise ? (
          <ExercisePane
            known={exerciseCategory !== null}
            detail={
              snapshot.screens[`exercise:${exerciseCategory}`] as
                Methods['strength.exercise']['result'] | undefined
            }
          />
        ) : null}
        {onRecordings ? (
          <RecordingsPane
            answer={snapshot.screens.recordings as Methods['recordings.list']['result'] | undefined}
          />
        ) : null}
        {onRecording ? (
          <RecordingPane
            answer={
              snapshot.screens[`recording:${route.id}`] as
                Methods['recordings.get']['result'] | undefined
            }
          />
        ) : null}
        {onDashboard ? (
          <FitnessPane
            snapshot={snapshot}
            choices={choices}
            onChoose={(next) => go(fitnessQuery(route, next))}
            onBestPeriod={session.setBestEffortDays}
          />
        ) : null}
        {onDashboard ? (
          <InsightsPane
            parts={snapshot.screens[INSIGHTS_PARTS_KEY] as InsightsParts | undefined}
            opened={parseOpened(queryValue(route, 'open'))}
            onOpen={(key) => go({ ...route, query: key === null ? [] : [['open', key]] })}
          />
        ) : null}
        {connected && !ownPane ? (
          <section id="later">
            <h2 id="later-title">{t(SCREEN_NAMES[tab])}</h2>
            <p>{t('connectPage.laterScreen')}</p>
          </section>
        ) : null}
        {connected && keysOpen ? <KeysPane /> : null}
      </main>

      <footer>
        <p>{t('connectPage.footer')}</p>
        {!pairing && (
          <button id="forget" type="button" onClick={session.unlink}>
            {t('connectPage.unlink')}
          </button>
        )}
      </footer>
    </>
  );
}

function PairPane({ state, code }: { state: State; code: string | null }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (code && canvas.current) drawCode(canvas.current, code);
  }, [code]);
  const notice = state.name === 'unpaired' || state.name === 'inviting' ? state.notice : undefined;
  return (
    <section id="pair">
      <h2>{t('connectPage.pair.heading')}</h2>
      <ol>
        <li>{t('connectPage.pair.step1')}</li>
        <li>{t('connectPage.pair.step2')}</li>
        <li>{t('connectPage.pair.step3')}</li>
      </ol>
      <canvas
        ref={canvas}
        id="code"
        width={360}
        height={360}
        aria-label={t('connectPage.pair.codeLabel')}
      />
      {notice ? (
        <p id="pair-notice" className="notice">
          {t(NOTICE[notice])}
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
  const palette = getComputedStyle(document.documentElement);
  context.fillStyle = palette.getPropertyValue('--colour-neutral-0').trim();
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = palette.getPropertyValue('--colour-neutral-950').trim();
  const offset = Math.floor((canvas.width - size * scale) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x])
        context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
    }
  }
}

function WaitingPane({ state }: { state: State }) {
  const { t } = useTranslation();
  return (
    <section id="waiting">
      <h2>{t('connectPage.waiting.heading')}</h2>
      <p>{t(waitingKey(state))}</p>
    </section>
  );
}

function UpdatePane() {
  const { t } = useTranslation();
  return (
    <section id="update">
      <h2>{t('connectPage.update.heading')}</h2>
      <p>{t('connectPage.update.body')}</p>
    </section>
  );
}

/** A definition list of the facts that have a value. */
function Facts({ id, facts }: { id: string; facts: [label: string, value: string | null][] }) {
  return (
    <dl id={id}>
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

/** The phone's controls for a screen, each showing its value and disabled. */
function SettingControls({ screen, reads }: { screen: string; reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  const controls = paneControls(screen, reads['settings.get']);
  return (
    <Panel label={t('connectPage.screens.settings')}>
      <ul id="settings-rows" className="readonly settings-list">
        {controls.map((control) => (
          <li key={control.key} className="settings-row">
            {control.kind === 'choice' ? (
              <Select
                label={t(control.label)}
                value={control.value ?? ''}
                disabled
                onChange={() => undefined}
                options={[
                  ...(control.value === null
                    ? [{ value: '', label: t('connectPage.settings.notSet') }]
                    : []),
                  ...control.options.map((option) => ({
                    value: option.value,
                    label: t(option.label),
                  })),
                ]}
              />
            ) : (
              <>
                <span className="settings-label">{t(control.label)}</span>
                <span className="settings-value">
                  {control.value ?? t('connectPage.settings.notSet')}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The library's state on the phone: sync, what is downloaded, the cache and detection. */
function LibraryStatus({ reads }: { reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  const coverage = reads['status.coverage'];
  const cache = reads['status.cache'];
  const jobs = reads['status.backgroundJobs'];
  const sync = reads['status.sync'];
  return (
    <Facts
      id="settings-status"
      facts={[
        [t('connectPage.settings.sync'), sync?.state ?? null],
        [
          t('connectPage.settings.activitiesOnPhone'),
          coverage && coverage.upstream > 0 ? `${coverage.fetched} of ${coverage.upstream}` : null,
        ],
        [
          t('connectPage.settings.tracksOnPhone'),
          coverage && coverage.tracksUpstream > 0
            ? `${coverage.tracksStored} of ${coverage.tracksUpstream}`
            : null,
        ],
        [
          t('connectPage.settings.streamCache'),
          cache ? `${(cache.streamStoreBytes / 1e6).toFixed(1)} MB` : null,
        ],
        [
          t('connectPage.settings.awaitingDetection'),
          jobs?.detectionAwaiting == null ? null : String(jobs.detectionAwaiting),
        ],
      ]}
    />
  );
}

/**
 * What the phone holds for a readable screen, read-only, or nothing when the
 * page does not read that screen's values.
 */
function ScreenReadout({ screen, reads }: { screen: string; reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  if (screen in SCREEN_SETTINGS) return <SettingControls screen={screen} reads={reads} />;
  if (screen === 'linked-devices') {
    const devices = reads['status.linkedDevices'];
    return (
      <ul id="settings-devices">
        {(devices ? deviceLines(devices) : []).map((line, at) => (
          <li key={at}>
            {line.thisBrowser
              ? t('connectPage.settings.deviceThisBrowser', { name: line.name })
              : line.name}
          </li>
        ))}
      </ul>
    );
  }
  if (screen === 'backup-settings') {
    return (
      <Facts
        id="settings-backup"
        facts={[
          [
            t('connectPage.settings.backup'),
            reads['status.backup'] ? t('connectPage.settings.backupSetUp') : null,
          ],
        ]}
      />
    );
  }
  return <LibraryStatus reads={reads} />;
}

/** The athlete's profile as the phone holds it. */
function Profile({ reads }: { reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  const profile = reads['settings.profile'];
  return (
    <Facts
      id="settings-profile"
      facts={[
        [t('connectPage.settings.name'), profile?.name ?? null],
        [t('connectPage.settings.units'), profile?.measurementPreference ?? null],
        [
          t('connectPage.settings.weight'),
          profile?.weightKg == null ? null : `${profile.weightKg} kg`,
        ],
      ]}
    />
  );
}

/** The exercise category a route names, or null when it is not one. */
function exerciseOf(id: string | null): number | null {
  const category = Number(id);
  return id !== null && Number.isInteger(category) && category >= 0 && category <= 65535
    ? category
    : null;
}

/** A muscle slug as a label: `upper-back` reads `Upper back`. */
function slugLabel(slug: string) {
  const text = slug.replace(/[-_]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A week or session start, read as the local date the engine stamped it with. */
const dayOf = (wallSecondsValue: number) =>
  new Date(wallSecondsValue * 1000).toISOString().slice(0, 10);

/** Sets, which may be a half where a secondary muscle counts half. */
const setCount = (sets: number) => String(Math.round(sets * 10) / 10);

const STRENGTH_PERIODS: [period: string, days: number, label: ParseKeys][] = [
  ['7d', 7, 'connectPage.strength.period7d'],
  ['1m', 30, 'connectPage.strength.period1m'],
  ['3m', 90, 'connectPage.strength.period3m'],
  ['6m', 180, 'connectPage.strength.period6m'],
  ['1y', 365, 'connectPage.strength.period1y'],
];

/** A table of rows of cell texts under a header. */
function Table({
  id,
  head,
  rows,
  bodyId,
}: {
  id: string;
  head: string[];
  rows: (string | ReactNode)[][];
  bodyId: string;
}) {
  return (
    <table id={id}>
      <thead>
        <tr>
          {head.map((title) => (
            <th key={title} scope="col">
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody id={bodyId}>
        {rows.map((cells, row) => (
          <tr key={row}>
            {cells.map((cell, at) => (
              <td key={at}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The strength tab: the period's muscles, the trailing weeks and the exercises behind each muscle. */
function StrengthPane({
  days,
  screen,
}: {
  days: number;
  screen: Methods['strength.screen']['result'] | undefined;
}) {
  const { t } = useTranslation();
  const owed = screen?.owedCount ?? 0;
  return (
    <section id="strength">
      <h2>{t('connectPage.strength.heading')}</h2>
      <nav id="strength-periods" aria-label={t('connectPage.strength.period')}>
        {STRENGTH_PERIODS.map(([period, span, label]) => (
          <a
            key={period}
            href={`#/insights?type=strength&period=${period}`}
            data-days={span}
            aria-current={span === days}
          >
            {t(label)}
          </a>
        ))}
      </nav>
      {owed > 0 ? (
        <p id="strength-owed">{t('connectPage.strength.owed', { count: owed })}</p>
      ) : null}
      <h3>{t('connectPage.strength.muscles')}</h3>
      <Table
        id="strength-muscles"
        bodyId="strength-muscle-rows"
        head={[
          t('connectPage.strength.colMuscle'),
          t('connectPage.strength.colWeightedSets'),
          t('connectPage.strength.colReps'),
          t('connectPage.strength.colVolume'),
          t('connectPage.strength.colExercises'),
        ]}
        rows={(screen?.summary.muscleVolumes ?? []).map((muscle) => [
          slugLabel(muscle.slug),
          setCount(muscle.weightedSets),
          String(muscle.totalReps),
          String(Math.round(muscle.volumeKg)),
          muscle.exerciseNames.join(', '),
        ])}
      />
      <h3>{t('connectPage.strength.weeks')}</h3>
      <Table
        id="strength-weeks"
        bodyId="strength-week-rows"
        head={[
          t('connectPage.strength.colWeekOf'),
          t('connectPage.strength.colSessions'),
          t('connectPage.strength.colSets'),
          t('connectPage.strength.colMostWorked'),
        ]}
        rows={(screen?.weekly ?? []).map((week) => [
          dayOf(week.startTs),
          String(week.activityCount),
          String(week.totalSets),
          setCount(week.maxWeightedSets),
        ])}
      />
      <h3>{t('connectPage.strength.exercises')}</h3>
      <div id="strength-exercises">
        {(screen?.exercises ?? []).map((group) => (
          <section key={group.muscleSlug}>
            <h3>{slugLabel(group.muscleSlug)}</h3>
            <ul>
              {group.exercises.map((exercise) => (
                <li key={exercise.exerciseCategory}>
                  <a
                    href={write({
                      screen: 'exercise',
                      id: String(exercise.exerciseCategory),
                      query: [],
                    })}
                  >
                    {exercise.exerciseName}
                  </a>
                  <span className="meta">
                    {t('connectPage.strength.line', {
                      sets: exercise.totalSets,
                      reps: exercise.totalReps,
                      kg: Math.round(exercise.volumeKg),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

/** One exercise: the sessions it was done in, each with its best set and estimated one-rep max. */
function ExercisePane({
  known,
  detail,
}: {
  known: boolean;
  detail: Methods['strength.exercise']['result'] | undefined;
}) {
  const { t } = useTranslation();
  return (
    <section id="exercise">
      <h2 id="exercise-title">
        {known
          ? (detail?.exerciseName ?? t('connectPage.strength.exercise'))
          : t('connectPage.strength.unknownExercise')}
      </h2>
      <Table
        id="exercise-sessions"
        bodyId="exercise-session-rows"
        head={[
          t('connectPage.strength.colDate'),
          t('connectPage.strength.colActivity'),
          t('connectPage.strength.colBestSet'),
          t('connectPage.strength.colOneRepMax'),
        ]}
        rows={(known ? (detail?.sessions ?? []) : []).map((entry) => {
          const best = entry.bestSet;
          const weight = best.weightKg == null ? null : `${best.weightKg} kg`;
          const reps =
            best.repetitions == null
              ? null
              : t('connectPage.strength.bestSetReps', { count: best.repetitions });
          return [
            dayOf(entry.date),
            entry.activityName,
            [weight, reps].filter(Boolean).join(' × '),
            entry.estimatedOneRepMaxKg == null
              ? ''
              : `${Math.round(entry.estimatedOneRepMaxKg)} kg`,
          ];
        })}
      />
    </section>
  );
}

/** The recordings on this phone that the signed-in athlete may see, newest first. */
function RecordingsPane({ answer }: { answer: Methods['recordings.list']['result'] | undefined }) {
  const { t } = useTranslation();
  return (
    <section id="recordings">
      <h2>{t('connectPage.recordings.heading')}</h2>
      <p>{t('connectPage.recordings.intro')}</p>
      <ul id="recordings-list">
        {(answer?.recordings ?? []).map((row) => (
          <li key={row.id}>
            <a href={write({ screen: 'recording', id: row.id, query: [] })}>{row.name}</a>
            <span className="meta">
              {[
                new Date(row.startTime).toLocaleDateString(),
                row.activityType,
                km(row.distanceMeters),
                clock(row.durationSeconds),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One recording's facts. The track is drawn by the map, and nothing here uploads or deletes. */
function RecordingPane({ answer }: { answer: Methods['recordings.get']['result'] | undefined }) {
  const { t } = useTranslation();
  const recording = answer?.recording;
  if (!recording) {
    return (
      <section id="recording">
        <h2 id="recording-title">
          {answer ? t('connectPage.recordings.notFound') : t('connectPage.recordings.one')}
        </h2>
        <dl id="recording-facts" />
      </section>
    );
  }
  const facts: [label: string, value: string | null][] = [
    [t('connectPage.recordings.activityType'), recording.activityType],
    [t('connectPage.recordings.started'), new Date(recording.startTime).toLocaleString()],
    [t('connectPage.recordings.duration'), clock(recording.durationSeconds)],
    [t('connectPage.facts.distance'), km(recording.distanceMeters)],
    [
      t('connectPage.facts.climbing'),
      recording.elevationGain == null ? null : `${Math.round(recording.elevationGain)} m`,
    ],
    [
      t('connectPage.facts.averageHr'),
      recording.avgHeartrate == null ? null : `${Math.round(recording.avgHeartrate)} bpm`,
    ],
    [t('connectPage.recordings.upload'), recording.uploadStatus],
    [t('connectPage.recordings.lastError'), recording.lastError],
    [t('connectPage.recordings.notes'), recording.notes],
  ];
  return (
    <section id="recording">
      <h2 id="recording-title">{recording.name}</h2>
      <dl id="recording-facts">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
      </dl>
    </section>
  );
}

function KeysPane() {
  const { t } = useTranslation();
  return (
    <section id="keys">
      <h2>{t('connectPage.keys.heading')}</h2>
      <dl>
        <dt>{t('connectPage.keys.range')}</dt>
        <dd>{t('connectPage.keys.tabs')}</dd>
        <dt>/</dt>
        <dd>{t('connectPage.keys.search')}</dd>
        <dt>Esc</dt>
        <dd>{t('connectPage.keys.close')}</dd>
        <dt>?</dt>
        <dd>{t('connectPage.keys.list')}</dd>
      </dl>
    </section>
  );
}

/** The phone's settings hub as a list on the left and the chosen screen on the right. */
function SettingsPane({ id, reads }: { id: string | null; reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  return (
    <section id="settings">
      <nav id="settings-list" aria-label={t('connectPage.screens.settings')}>
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title} className="settings-group">
            <h2>{t(group.title)}</h2>
            <ul>
              {group.rows.map((row) => (
                <li key={row.screen}>
                  <a href={`#/settings/${row.screen}`} aria-current={id === row.screen}>
                    {t(row.title)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="settings-group">
          <h2>{t('connectPage.settings.onThePhone')}</h2>
          <ul>
            {ON_THE_PHONE.map((entry) => (
              <li key={entry.title}>
                {entry.screen ? (
                  <a href={`#/settings/${entry.screen}`} aria-current={id === entry.screen}>
                    {t(entry.title)}
                  </a>
                ) : (
                  t(entry.title)
                )}
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div id="settings-pane">
        <SettingsBody shown={pane(id)} screen={id} reads={reads} />
      </div>
    </section>
  );
}

function SettingsBody({
  shown,
  screen,
  reads,
}: {
  shown: Pane;
  screen: string | null;
  reads: Readonly<SettingsReads>;
}) {
  const { t } = useTranslation();
  if (shown.kind === 'readable') {
    return (
      <>
        <h2 id="settings-title">{t(shown.title)}</h2>
        <p className="note">{t(shown.note)}</p>
        {screen && readsScreen(screen) ? <ScreenReadout screen={screen} reads={reads} /> : null}
      </>
    );
  }
  if (shown.kind === 'phone') {
    return (
      <>
        <h2 id="settings-title">{t(shown.title)}</h2>
        <p>{t(shown.why)}</p>
        <p className="note">{t('connectPage.settings.openOnPhone')}</p>
      </>
    );
  }
  if (shown.kind === 'unknown') {
    return (
      <>
        <h2 id="settings-title">{t('connectPage.settings.notOnBrowser')}</h2>
        <p>{t('connectPage.settings.notOnBrowserBody')}</p>
      </>
    );
  }
  return (
    <>
      <h2 id="settings-title">{t('connectPage.settings.pick')}</h2>
      <p className="note">{t(PANE_NOTE)}</p>
      <h3>{t('connectPage.settings.profile')}</h3>
      <Profile reads={reads} />
      <h3>{t('connectPage.settings.libraryStatus')}</h3>
      <LibraryStatus reads={reads} />
    </>
  );
}

function Library(props: {
  cards: Card[];
  more: boolean;
  summary: Summary | null;
  sparklines: Sparklines | null;
  highlights: Readonly<Record<string, string[]>>;
  previews: Readonly<Record<string, string>>;
  onMore: () => void;
  detail: Detail | undefined;
  shownId: string | null;
  route: Route;
  query: FeedQuery;
  search: string;
  onSearch: (value: string) => void;
  onPreview: (id: string | null) => void;
  details: Readonly<Record<string, Detail | undefined>>;
}) {
  const { t } = useTranslation();
  const [dropped, setDropped] = useState<string[]>([]);
  const compared = props.query.ids
    .map((id) => props.cards.find((row) => row.id === id))
    .filter((row): row is Card => row !== undefined);
  const comparing = compared.length >= 2;
  const card = props.cards.find((row) => row.id === props.shownId);
  const rows = sortRows(props.cards, props.query.sort);
  return (
    <section id="library">
      {props.summary ? <SummaryStrip card={props.summary} lines={props.sparklines} /> : null}
      <FilterBar query={props.query} search={props.search} onSearch={props.onSearch} />
      <div id="list-pane">
        {props.query.sort && props.more ? (
          <p id="sort-note" role="note">
            {t('connectPage.library.sortNote', { count: props.cards.length })}
          </p>
        ) : null}
        <FeedTable
          rows={rows}
          highlights={props.highlights}
          previews={props.previews}
          query={props.query}
          onPreview={props.onPreview}
          onDropped={setDropped}
        />
        {props.more ? <MoreButton onMore={props.onMore} /> : null}
      </div>
      <aside id="detail-pane" aria-label={t('connectPage.library.detailLabel')}>
        {comparing ? (
          <CompareTable
            cards={compared}
            details={props.details}
            dropped={props.cards.filter((row) => dropped.includes(row.id)).map((row) => row.name)}
          />
        ) : card ? (
          <>
            <h2 id="detail-title">{card.name}</h2>
            <DetailFacts card={card} detail={props.detail} />
            <a className="open-activity" href={`#/activity/${encodeURIComponent(card.id)}`}>
              {t('connectPage.library.open')}
            </a>
          </>
        ) : (
          <EmptyState title={t('connectPage.library.pick')} />
        )}
      </aside>
    </section>
  );
}

/** Point the feed at a state, keeping the screen. */
function goFeed(query: FeedQuery) {
  go({ screen: 'feed', id: null, query: feedQuery(query) });
}

/** The week's totals and the wellness headlines, as four tiles above the list. */
function SummaryStrip({ card, lines }: { card: Summary; lines: Sparklines | null }) {
  const { t } = useTranslation();
  const { wellness } = card;
  const whole = (value: number | null | undefined) =>
    value == null ? null : String(Math.round(value));
  const week = (total: Summary['currentWeek']) =>
    t('connectPage.weekTotal', { time: clock(total.totalDuration), count: total.count });
  const readings = [
    wellness.hrv == null ? null : `${t('connectPage.facts.hrv')} ${whole(wellness.hrv)}`,
    wellness.rhr == null ? null : `${t('connectPage.facts.restingHr')} ${whole(wellness.rhr)} bpm`,
  ].filter((reading): reading is string => reading !== null);
  const tiles: { key: string; label: string; value: string | null; note?: string }[] = [
    { key: 'thisWeek', label: t('connectPage.facts.thisWeek'), value: week(card.currentWeek) },
    { key: 'lastWeek', label: t('connectPage.facts.lastWeek'), value: week(card.prevWeek) },
    { key: 'fitness', label: t('connectPage.facts.fitness'), value: whole(wellness.fitness) },
    {
      key: 'form',
      label: t('connectPage.facts.form'),
      value: whole(wellness.form),
      note: readings.join(' · '),
    },
  ];
  return (
    <section id="summary" aria-label={t('connectPage.library.summary')}>
      {tiles.map((tile) => (
        <Surface key={tile.key} label={tile.label}>
          <p className="tile-label">{tile.label}</p>
          <p className="tile-value">{tile.value ?? '–'}</p>
          {tile.key === 'fitness' ? (
            <svg
              id="summary-spark"
              viewBox="0 0 120 32"
              role="img"
              aria-label={t('connectPage.library.fitnessTrend')}
            >
              <polyline
                id="summary-line"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                points={sparkPoints(lines?.fitness ?? [])}
              />
            </svg>
          ) : tile.note ? (
            <p className="tile-note">{tile.note}</p>
          ) : null}
        </Surface>
      ))}
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

/** The one filter bar: the range, the sport families and the search. */
function FilterBar({
  query,
  search,
  onSearch,
}: {
  query: FeedQuery;
  search: string;
  onSearch: (value: string) => void;
}) {
  const { t } = useTranslation();
  const everything = 'all';
  return (
    <div id="filters" role="search">
      <SegmentedControl<RangePreset | typeof everything>
        label={t('connectPage.library.range')}
        value={query.range ?? everything}
        options={[
          { value: everything, label: t('connectPage.library.all') },
          ...RANGES.map((preset: RangePreset) => ({
            value: preset,
            label: t(RANGE_LABELS[preset]),
          })),
        ]}
        onChange={(value) => goFeed({ ...query, range: value === everything ? null : value })}
      />
      <ChipGroup label={t('connectPage.library.sportLabel')}>
        {FAMILIES.map(([family, label]) => {
          const on = query.families.includes(family);
          return (
            <Chip
              key={family}
              selected={on}
              onToggle={() =>
                goFeed({
                  ...query,
                  families: on
                    ? query.families.filter((held) => held !== family)
                    : [...query.families, family],
                })
              }
            >
              {t(label)}
            </Chip>
          );
        })}
      </ChipGroup>
      <SearchField
        id="search"
        label={t('connectPage.library.searchLabel')}
        clearLabel={t('connectPage.library.clearSearch')}
        placeholder={t('connectPage.library.searchPlaceholder')}
        value={search}
        onChange={onSearch}
      />
    </div>
  );
}

/** Reads the next page when clicked or when it scrolls into view. */
function MoreButton({ onMore }: { onMore: () => void }) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = anchor.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) onMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMore]);
  return (
    <div ref={anchor} id="feed-more">
      <Button variant="secondary" onClick={onMore}>
        {t('connectPage.library.loadMore')}
      </Button>
    </div>
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
    case 'load':
      return card.trainingLoad == null ? null : String(Math.round(card.trainingLoad));
    default:
      return card.name;
  }
};

/** The columns the table shows; the rest of the sort keys stay in the address. */
const TABLE_COLUMNS: readonly ColumnKey[] = ['date', 'name', 'sport', 'distance', 'time', 'load'];

function FeedTable({
  rows,
  highlights,
  previews,
  query,
  onPreview,
  onDropped,
}: {
  rows: Card[];
  highlights: Readonly<Record<string, string[]>>;
  previews: Readonly<Record<string, string>>;
  query: FeedQuery;
  onPreview: (id: string | null) => void;
  onDropped: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(hover.current);
      onPreview(null);
    },
    [onPreview]
  );
  const columns: Column<Card>[] = COLUMNS.filter((column) =>
    TABLE_COLUMNS.includes(column.key)
  ).map((column) => ({
    key: column.key,
    header: t(column.label),
    numeric: column.numeric,
    sortable: true,
    cell: (card: Card) => {
      if (column.key === 'name') {
        return (
          <span className="feed-name">
            <Thumbnail card={card} preview={previews[card.id]} />
            <span className="feed-title">
              <span className="name">{card.name}</span>
              {highlights[card.id]?.length ? (
                <span className="feed-badges">
                  {(highlights[card.id] ?? []).map((label, at) => (
                    <Badge key={at}>{label}</Badge>
                  ))}
                </span>
              ) : null}
            </span>
          </span>
        );
      }
      if (column.key === 'sport') {
        const sport = sportMark(card.sportType);
        return <SportGlyph family={sport.family} label={card.sportType ?? ''} />;
      }
      return cell(card, column.key);
    },
  }));
  const selected = new Set([...(query.id ? [query.id] : []), ...query.ids]);
  return (
    <div id="feed-scroll" className="feed-table">
      <DataTable
        label={t('connectPage.library.activities')}
        columns={columns}
        rows={rows}
        rowKey={(card) => card.id}
        {...(query.sort ? { sort: { key: query.sort.column, direction: query.sort.dir } } : {})}
        onSort={(key) => goFeed({ ...query, sort: nextSort(query.sort, key as ColumnKey) })}
        onRowHover={(card) => {
          clearTimeout(hover.current);
          onPreview(null);
          if (card) hover.current = setTimeout(() => onPreview(card.id), PREVIEW_DELAY_MS);
        }}
        onRowClick={(card, event) => {
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
        isSelected={(card) => selected.has(card.id)}
      />
    </div>
  );
}

/** The track as a static line, or the sport's mark where the card has no track. */
export function Thumbnail({ card, preview }: { card: Card; preview: string | undefined }) {
  const shape = card.hasGps && preview ? trackShape(preview) : null;
  const sport = sportMark(card.sportType);
  if (!shape) {
    return (
      <span className="thumb thumb-sport" data-sport={sport.family} aria-hidden="true">
        {sport.mark}
      </span>
    );
  }
  return (
    <svg
      className="thumb"
      data-sport={sport.family}
      viewBox={`0 0 ${THUMB} ${THUMB}`}
      aria-hidden="true"
    >
      <path d={shape.path} className="thumb-line" />
      <circle cx={shape.start[0]} cy={shape.start[1]} r="2.5" className="thumb-start" />
      <circle cx={shape.end[0]} cy={shape.end[1]} r="2.5" className="thumb-end" />
    </svg>
  );
}

/** One column per compared activity, the best value in each row marked. */
function CompareTable(props: {
  cards: Card[];
  details: Readonly<Record<string, Detail | undefined>>;
  dropped: string[];
}) {
  const { t } = useTranslation();
  const rows = compareRows(props.cards, props.details);
  return (
    <section id="compare">
      <h2 id="detail-title">{t('connectPage.compare.heading', { count: props.cards.length })}</h2>
      {props.dropped.length ? (
        <p id="compare-note" role="status">
          {t('connectPage.compare.dropped', { names: props.dropped.join(', ') })}
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
              <th scope="row">{t(row.label)}</th>
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
  const { t } = useTranslation();
  const facts: [label: string, value: string | null][] =
    card && detail
      ? [
          [t('connectPage.facts.distance'), km(card.distance)],
          [t('connectPage.facts.movingTime'), clock(detail.movingTime)],
          [t('connectPage.facts.elapsedTime'), clock(detail.elapsedTime)],
          [t('connectPage.facts.averageSpeed'), kmh(detail.averageSpeed)],
          [t('connectPage.facts.topSpeed'), kmh(detail.maxSpeed)],
          [
            t('connectPage.facts.climbing'),
            card.elevationGain == null ? null : `${Math.round(card.elevationGain)} m`,
          ],
          [
            t('connectPage.facts.averageHr'),
            card.avgHr == null ? null : `${Math.round(card.avgHr)} bpm`,
          ],
          [
            t('connectPage.facts.averagePower'),
            card.avgPower == null ? null : `${Math.round(card.avgPower)} W`,
          ],
          [
            t('connectPage.facts.trainingLoad'),
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
