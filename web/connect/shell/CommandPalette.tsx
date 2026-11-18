// The command palette: one search box over the pages, the actions, the settings,
// and the activities, routes, sections, exercises, workouts and recordings the
// phone holds. Opened empty it lists the items opened last, the pages and the
// actions; typed into, it lists what matches in a group per kind with a heading,
// at most five each, and a "Show all" row that opens the kind's own list with the
// text as its filter. Pages, actions and settings filter as the athlete types; the
// rest are asked of the phone once typing pauses. Arrow keys move, Enter chooses,
// Escape closes.

import type { ParseKeys } from 'i18next';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  PER_GROUP,
  groupResults,
  parseRecent,
  LOOSE,
  rank,
  remember,
  score,
  showAllRoute,
  type Kind,
  type Recent,
} from '../palette';
import { NAV } from '../pages';
import { feedPageAsk } from '../link';
import { parse, type Route } from '../router';
import { opening, queryFor } from '../routesList';
import { SETTINGS_GROUPS } from '../settings';
import { stepIndex } from '../ui/behaviour';
import { Dialog } from '../ui/Dialog';
import { matchesFilter } from '../ui/filterText';
import { TextField } from '../ui/TextField';
import { useRead } from '../useRead';

export type PaletteAction = { id: string; label: string; run: () => void };

/** The most a list is asked for when one query reaches a kind, so a show-all row can count them. */
const ASKED = 50;
const TYPING_PAUSE_MS = 150;

/** Where the browser keeps the items opened from the palette. */
export const RECENT_KEY = 'veloq-connect-recent';

function readRecent(): Recent[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

function keepRecent(list: readonly Recent[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage that is blocked leaves the list for this visit only.
  }
}

const GROUP_TITLES: Record<Kind, ParseKeys> = {
  page: 'connectPage.palette.groups.page',
  action: 'connectPage.palette.groups.action',
  setting: 'connectPage.palette.groups.setting',
  activity: 'connectPage.palette.groups.activity',
  route: 'connectPage.palette.groups.route',
  section: 'connectPage.palette.groups.section',
  exercise: 'connectPage.palette.groups.exercise',
  workout: 'connectPage.palette.groups.workout',
  recording: 'connectPage.palette.groups.recording',
};

/** One row the athlete can choose. */
type Entry = {
  id: string;
  label: string;
  detail?: string;
  /** What choosing it does. */
  run: () => void;
  /** True for a show-all row, drawn quieter. */
  more?: boolean;
};

type Section = { id: string; heading: string; entries: Entry[] };

type PaletteProps = {
  open: boolean;
  onClose: () => void;
  navigate: (route: Route) => void;
  actions: readonly PaletteAction[];
};

/** Drawn only while open, so each opening starts with an empty box. */
export function CommandPalette(props: PaletteProps) {
  return props.open ? <OpenPalette {...props} /> : null;
}

/** What a row stands for, before it is a row: an item to open, or an action to run. */
type Found = {
  id: string;
  kind: Kind;
  label: string;
  detail?: string;
} & ({ route: Route; run?: undefined } | { route?: undefined; run: () => void });

function OpenPalette(props: PaletteProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [needle, setNeedle] = useState('');
  const [at, setAt] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  const [openedAt] = useState(() => Math.floor(Date.now() / 1000));
  const listId = useId();
  const query = text.trim();

  useEffect(() => {
    if (query === needle) return undefined;
    const typing = setTimeout(() => setNeedle(query), TYPING_PAUSE_MS);
    return () => clearTimeout(typing);
  }, [query, needle]);

  const asking = needle !== '';
  const activities = useRead(
    'feed.page',
    asking ? { ...feedPageAsk({ families: [], needle }, 0), limit: PER_GROUP } : null
  );
  const lists = useRead(
    'routes.screen',
    asking
      ? {
          ...queryFor({
            routes: { ...opening('routes'), search: needle },
            sections: { ...opening('sections'), search: needle },
            focus: 'routes',
            order: null,
          }),
          groupLimit: ASKED,
          sectionLimit: ASKED,
          userLat: 0,
          userLng: 0,
        }
      : null
  );
  const exercises = useRead(
    'strength.picker',
    asking
      ? {
          equipment: [],
          region: null,
          muscle: null,
          query: needle,
          afterCategory: null,
          afterName: null,
          nowWallSeconds: openedAt,
        }
      : null
  );
  // The workouts page asks with an empty object too, so the two share one answer.
  const workouts = useRead('strength.workouts', asking ? ({} as { unused: null }) : null);
  const recordings = useRead('recordings.list', asking ? {} : null);

  const sections = useMemo<Section[]>(() => {
    const open = (item: { id: string; kind: Kind; label: string; route: Route }) => () => {
      if (item.kind !== 'page') {
        const next = remember(recent, item);
        setRecent(next);
        keepRecent(next);
      }
      props.onClose();
      props.navigate(item.route);
    };
    const rowOf = (found: Found): Entry => ({
      id: found.id,
      label: found.label,
      ...(found.detail ? { detail: found.detail } : {}),
      run: found.run ?? open({ ...found, route: found.route as Route }),
    });
    const heading = (kind: Kind) => t(GROUP_TITLES[kind]);

    const pages: Found[] = NAV.flatMap((group) => group.entries).map((page) => ({
      id: `page:${page.key}`,
      kind: 'page',
      label: t(page.title),
      route: parse(page.href),
    }));
    const settings: Found[] = SETTINGS_GROUPS.flatMap((group) => group.rows).map((row) => ({
      id: `setting:${row.screen}`,
      kind: 'setting',
      label: t(row.title),
      route: { screen: 'settings', id: row.screen, query: [] },
    }));
    const actions = rank(
      props.actions.map<Found>((action) => ({
        id: `action:${action.id}`,
        kind: 'action',
        label: action.label,
        run: () => {
          props.onClose();
          action.run();
        },
      })),
      query
    );

    if (query === '') {
      const latest = recent.map<Entry>((item) => ({
        id: `recent:${item.id}`,
        label: item.label,
        run: open(item),
      }));
      return [
        { id: 'recent', heading: t('connectPage.palette.groups.recent'), entries: latest },
        { id: 'page', heading: heading('page'), entries: pages.map(rowOf) },
        { id: 'action', heading: heading('action'), entries: actions.map(rowOf) },
      ].filter((section) => section.entries.length > 0);
    }

    const remote: Found[] = [
      ...(activities.data?.cards ?? []).map<Found>((card) => ({
        id: `activity:${card.id}`,
        kind: 'activity',
        label: card.name,
        detail: [card.startDateLocal?.slice(0, 10), card.sportType].filter(Boolean).join(' · '),
        route: { screen: 'activity', id: card.id, query: [] },
      })),
      ...(lists.data?.groups ?? []).map<Found>((group) => ({
        id: `route:${group.groupId}`,
        kind: 'route',
        label: group.customName ?? t('connectPage.routes.unnamedRoute'),
        route: { screen: 'route', id: group.groupId, query: [] },
      })),
      ...(lists.data?.sections ?? []).map<Found>((section) => ({
        id: `section:${section.id}`,
        kind: 'section',
        label: section.name ?? t('connectPage.routes.unnamedSection'),
        route: { screen: 'section', id: section.id, query: [] },
      })),
      ...(exercises.data?.rows ?? []).map<Found>((row) => ({
        id: `exercise:${row.category}:${row.name}`,
        kind: 'exercise',
        label: row.displayName,
        route: { screen: 'exercise', id: String(row.category), query: [] },
      })),
      ...(workouts.data?.workouts ?? [])
        .filter((row) => matchesFilter(query, [row.name]))
        .map<Found>((row) => ({
          id: `workout:${row.id}`,
          kind: 'workout',
          label: row.name,
          route: { screen: 'workout', id: row.id, query: [] },
        })),
      ...(recordings.data?.recordings ?? [])
        .filter((row) => matchesFilter(query, [row.name]))
        .map<Found>((row) => ({
          id: `recording:${row.id}`,
          kind: 'recording',
          label: row.name,
          route: { screen: 'recording', id: row.id, query: [] },
        })),
    ];
    // A scattered match on a name is offered only when nothing else matched, so a name typed whole is not buried.
    const named = [...rank(pages, query), ...rank(settings, query), ...actions];
    const tight = named.filter((hit) => (score(hit.label, query) ?? LOOSE) < LOOSE);
    const local = remote.length > 0 || tight.length > 0 ? tight : named;
    const totals: Partial<Record<Kind, number>> = {
      route: lists.data?.groups.length ?? 0,
      section: lists.data?.sections.length ?? 0,
      activity: activities.data?.matchedCount ?? 0,
    };
    return groupResults([...local, ...remote], totals).map<Section>((group) => {
      const entries = group.hits.map(rowOf);
      const all = group.showAll ? showAllRoute(group.kind, query) : null;
      if (all) {
        entries.push({
          id: `all:${group.kind}`,
          label: t('connectPage.palette.showAll', { total: group.total }),
          run: () => {
            props.onClose();
            props.navigate(all);
          },
          more: true,
        });
      }
      return { id: group.kind, heading: heading(group.kind), entries };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    t,
    query,
    recent,
    props.actions,
    props.navigate,
    props.onClose,
    activities.data,
    lists.data,
    exercises.data,
    workouts.data,
    recordings.data,
  ]);

  const entries = sections.flatMap((section) => section.entries);
  const current = Math.min(at, Math.max(entries.length - 1, 0));

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      entries[current]?.run();
      return;
    }
    const to = stepIndex(event.key, current, entries.length);
    if (to === null || event.key === 'Home' || event.key === 'End') return;
    event.preventDefault();
    setAt(to);
  }

  const starts = sections.map((_, at) =>
    sections.slice(0, at).reduce((sum, section) => sum + section.entries.length, 0)
  );
  return (
    <Dialog
      open={props.open}
      anchor="top"
      title={t('connectPage.palette.title')}
      onClose={props.onClose}
    >
      <TextField
        id="palette-input"
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={entries[current] ? `${listId}-${current}` : undefined}
        aria-label={t('connectPage.palette.label')}
        placeholder={t('connectPage.palette.placeholder')}
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setAt(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" className="palette-list">
        {sections.flatMap((section, sectionAt) => [
          <li
            key={`heading:${section.id}`}
            role="presentation"
            className="palette-heading"
            data-group={section.id}
          >
            {section.heading}
          </li>,
          ...section.entries.map((entry, entryAt) => {
            const mine = (starts[sectionAt] ?? 0) + entryAt;
            return (
              <li
                key={entry.id}
                id={`${listId}-${mine}`}
                role="option"
                aria-selected={mine === current}
                data-group={section.id}
                className={entry.more ? 'palette-show-all' : undefined}
                onMouseEnter={() => setAt(mine)}
                onClick={entry.run}
              >
                <span className="palette-label">{entry.label}</span>
                {entry.detail ? <span className="palette-detail">{entry.detail}</span> : null}
              </li>
            );
          }),
        ])}
      </ul>
      {entries.length === 0 ? <p role="status">{t('connectPage.palette.none')}</p> : null}
    </Dialog>
  );
}
