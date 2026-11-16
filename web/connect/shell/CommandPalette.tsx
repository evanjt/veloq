// The command palette: one search box over the pages, the actions, and the
// activities, routes and sections the phone holds. Pages and actions filter as
// the athlete types; the rest are asked of the phone through the query layer
// once typing pauses, and the engine does the matching. Arrow keys move, Enter
// chooses, Escape closes.

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { LOOSE, rank, score } from '../palette';
import { NAV } from '../pages';
import { feedPageAsk } from '../link';
import { parse, type Route } from '../router';
import { opening, queryFor } from '../routesList';
import { stepIndex } from '../ui/behaviour';
import { Dialog } from '../ui/Dialog';
import { TextField } from '../ui/TextField';
import { useRead } from '../useRead';

export type PaletteAction = { id: string; label: string; run: () => void };

/** Entries asked of the phone for each kind. */
const PER_KIND = 8;
const TYPING_PAUSE_MS = 150;

type Entry = { id: string; label: string; detail?: string; kind: string; run: () => void };

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

function OpenPalette(props: PaletteProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [needle, setNeedle] = useState('');
  const [at, setAt] = useState(0);
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
    asking ? { ...feedPageAsk({ families: [], needle }, 0), limit: PER_KIND } : null
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
          groupLimit: PER_KIND,
          sectionLimit: PER_KIND,
          userLat: 0,
          userLng: 0,
        }
      : null
  );

  const entries = useMemo<Entry[]>(() => {
    const go = (route: Route) => () => {
      props.onClose();
      props.navigate(route);
    };
    const local: Entry[] = [
      ...NAV.flatMap((group) => group.entries).map((page) => ({
        id: `page:${page.key}`,
        label: t(page.title),
        kind: t('connectPage.palette.page'),
        run: () => {
          props.onClose();
          props.navigate(parse(page.href));
        },
      })),
      ...props.actions.map((action) => ({
        id: `action:${action.id}`,
        label: action.label,
        kind: t('connectPage.palette.action'),
        run: () => {
          props.onClose();
          action.run();
        },
      })),
    ];
    const remote: Entry[] = [
      ...(activities.data?.cards ?? []).map((card) => ({
        id: `activity:${card.id}`,
        label: card.name,
        detail: [card.startDateLocal?.slice(0, 10), card.sportType].filter(Boolean).join(' · '),
        kind: t('connectPage.palette.activity'),
        run: go({ screen: 'activity', id: card.id, query: [] }),
      })),
      ...(lists.data?.groups ?? []).map((group) => ({
        id: `route:${group.groupId}`,
        label: group.customName ?? t('connectPage.routes.unnamedRoute'),
        kind: t('connectPage.palette.route'),
        run: go({ screen: 'route', id: group.groupId, query: [] }),
      })),
      ...(lists.data?.sections ?? []).map((section) => ({
        id: `section:${section.id}`,
        label: section.name ?? t('connectPage.routes.unnamedSection'),
        kind: t('connectPage.palette.section'),
        run: go({ screen: 'section', id: section.id, query: [] }),
      })),
    ];
    // A scattered match on a page name follows what the phone found, so a name typed whole is not buried.
    const matches = rank(local, query);
    const tight = matches.filter((entry) => (score(entry.label, query) ?? LOOSE) < LOOSE);
    return [...tight, ...remote, ...matches.filter((entry) => !tight.includes(entry))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, query, props.actions, props.navigate, props.onClose, activities.data, lists.data]);

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

  return (
    <Dialog open={props.open} title={t('connectPage.palette.title')} onClose={props.onClose}>
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
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === current}
            data-kind={entry.kind}
            onMouseEnter={() => setAt(index)}
            onClick={entry.run}
          >
            <span className="palette-label">{entry.label}</span>
            {entry.detail ? <span className="palette-detail">{entry.detail}</span> : null}
            <span className="palette-kind">{entry.kind}</span>
          </li>
        ))}
      </ul>
      {entries.length === 0 ? <p role="status">{t('connectPage.palette.none')}</p> : null}
    </Dialog>
  );
}
