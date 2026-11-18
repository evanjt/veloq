// The connect page's map from an address to a page: which page a route is, the
// title the top bar gives it, the pages above it for the breadcrumb, and the
// sidebar entry that marks it. The sidebar's order and chords are the one table
// the digit keys, the `g` chords and the keys dialog all read. Pure, so a test
// reads it without a browser; the components each page renders are
// `pages/index.tsx`.

import type { ParseKeys } from 'i18next';

import { queryValue, type Route } from './router';
import type { RailIcon } from './RailGlyph';

export type PageKey =
  | 'feed'
  | 'activity'
  | 'map'
  | 'routes'
  | 'sections'
  | 'fitness'
  | 'insights'
  | 'strength'
  | 'exercise'
  | 'workouts'
  | 'live'
  | 'recordings'
  | 'recording'
  | 'settings'
  | 'later';

/** A sidebar entry. */
export type NavKey =
  | 'feed'
  | 'map'
  | 'routes'
  | 'sections'
  | 'fitness'
  | 'insights'
  | 'strength'
  | 'workouts'
  | 'recordings'
  | 'settings';

export type Crumb = { title: ParseKeys; href: string };

export type PageInfo = {
  key: PageKey;
  /** The screen's name; for a detail page, what the top bar reads until the page names its thing. */
  title: ParseKeys;
  /** The sidebar entry that is marked while the page is on view. */
  nav: NavKey;
  /** The pages above this one, outermost first. */
  parents: Crumb[];
  /** True when the page shows one named thing, whose name is the title. */
  named: boolean;
};

const ACTIVITIES: Crumb = { title: 'connectPage.library.activities', href: '#/activities' };
const ROUTES: Crumb = { title: 'connectPage.routes.routes', href: '#/routes' };
const SECTIONS: Crumb = { title: 'connectPage.routes.sections', href: '#/sections' };
const STRENGTH: Crumb = { title: 'connectPage.strength.heading', href: '#/strength' };
const WORKOUTS: Crumb = { title: 'connectPage.workouts.heading', href: '#/workouts' };
const RECORDINGS: Crumb = { title: 'connectPage.recordings.heading', href: '#/recordings' };
const SETTINGS: Crumb = { title: 'connectPage.screens.settings', href: '#/settings' };

const page = (
  key: PageKey,
  title: ParseKeys,
  nav: NavKey,
  rest: Partial<Pick<PageInfo, 'parents' | 'named'>> = {}
): PageInfo => ({ key, title, nav, parents: [], named: false, ...rest });

/** The page a route is. An address no page is built for reads as the feed's own, by the router. */
export function pageFor(route: Route): PageInfo {
  switch (route.screen) {
    case 'activity':
      return page('activity', 'connectPage.activity.untitled', 'feed', {
        parents: [ACTIVITIES],
        named: true,
      });
    case 'map':
      return page('map', 'connectPage.screens.map', 'map');
    case 'routes':
      return page('routes', ROUTES.title, 'routes');
    case 'route':
      return page('routes', 'connectPage.routes.unnamedRoute', 'routes', {
        parents: [ROUTES],
        named: true,
      });
    case 'sections':
      return page('sections', SECTIONS.title, 'sections');
    case 'section':
      return page('sections', 'connectPage.routes.unnamedSection', 'sections', {
        parents: [SECTIONS],
        named: true,
      });
    case 'fitness':
      return page('fitness', 'connectPage.screens.fitness', 'fitness');
    case 'insights':
      return queryValue(route, 'type') === 'strength'
        ? page('strength', STRENGTH.title, 'strength')
        : page('insights', 'connectPage.screens.insights', 'insights');
    case 'strength':
      return page('strength', STRENGTH.title, 'strength');
    case 'exercise':
      return page('exercise', 'connectPage.strength.exercise', 'strength', {
        parents: [STRENGTH],
        named: true,
      });
    case 'workouts':
      return page('workouts', WORKOUTS.title, 'workouts');
    case 'workout':
      return page('workouts', 'connectPage.workouts.building', 'workouts', {
        parents: [WORKOUTS],
        named: true,
      });
    case 'live':
      return page('live', 'connectPage.live.heading', 'strength', { parents: [STRENGTH] });
    case 'recordings':
      return page('recordings', RECORDINGS.title, 'recordings');
    case 'recording':
      return page('recording', 'connectPage.recordings.one', 'recordings', {
        parents: [RECORDINGS],
        named: true,
      });
    case 'settings':
      return route.id
        ? page('settings', 'connectPage.screens.settings', 'settings', {
            parents: [SETTINGS],
            named: true,
          })
        : page('settings', 'connectPage.screens.settings', 'settings');
    case 'best-efforts':
      return page('later', 'connectPage.screens.insights', 'insights');
    default:
      return page('feed', ACTIVITIES.title, 'feed');
  }
}

/** One sidebar entry. */
export type NavEntry = {
  key: NavKey;
  href: string;
  title: ParseKeys;
  icon: RailIcon;
  /** The letter after `g` that goes to the page; no two entries share one. */
  chord: string;
};

export type NavGroup = { title: ParseKeys; entries: NavEntry[] };

/** The sidebar: Training, Analysis and Library, each entry opening one page. */
export const NAV: NavGroup[] = [
  {
    title: 'connectPage.nav.training',
    entries: [
      { key: 'feed', href: '#/activities', title: ACTIVITIES.title, icon: 'feed', chord: 'f' },
      { key: 'map', href: '#/map', title: 'connectPage.screens.map', icon: 'map', chord: 'm' },
      { key: 'routes', href: '#/routes', title: ROUTES.title, icon: 'routes', chord: 'r' },
      { key: 'sections', href: '#/sections', title: SECTIONS.title, icon: 'sections', chord: 's' },
    ],
  },
  {
    title: 'connectPage.nav.analysis',
    entries: [
      {
        key: 'fitness',
        href: '#/fitness',
        title: 'connectPage.screens.fitness',
        icon: 'fitness',
        chord: 't',
      },
      {
        key: 'insights',
        href: '#/insights',
        title: 'connectPage.screens.insights',
        icon: 'insights',
        chord: 'i',
      },
      { key: 'strength', href: STRENGTH.href, title: STRENGTH.title, icon: 'strength', chord: 'x' },
      { key: 'workouts', href: '#/workouts', title: WORKOUTS.title, icon: 'workouts', chord: 'w' },
    ],
  },
  {
    title: 'connectPage.nav.library',
    entries: [
      {
        key: 'recordings',
        href: '#/recordings',
        title: RECORDINGS.title,
        icon: 'recordings',
        chord: 'd',
      },
      { key: 'settings', href: '#/settings', title: SETTINGS.title, icon: 'settings', chord: 'c' },
    ],
  },
];
