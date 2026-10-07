/**
 * The navigation chrome for every route the root stack owns, in one place.
 *
 * `null` is a screen that draws its own and takes no header: the tab group,
 * the two auth screens, the redirect, the full-screen recorder and the routes
 * list. Everything else takes the platform's header, titled from one i18n key,
 * which is the rule in `src/shared/ui/CLAUDE.md`. A screen has no header code
 * of its own. `overMap` is the header of a map-hero detail screen: transparent
 * with an empty title, so the platform's back control floats over the hero.
 *
 * The tab group's children belong to `(tabs)/_layout`, so they are not here.
 */

import type { ParseKeys } from 'i18next';

import { colors, darkColors } from '@/theme';

export interface ScreenHeader {
  /** i18n key for the title. Resolved in the layout, so the screen stays pure. */
  titleKey?: ParseKeys;
  /** Literal title, for the developer screen, which is not translated. */
  title?: string;
  /** The layout supplies a headerTitle of its own; the key above is what shows until it loads. */
  dynamic?: boolean;
  /** Transparent header with no title, laid over a full-bleed map hero. */
  overMap?: boolean;
}

export const SCREEN_HEADERS: Record<string, ScreenHeader | null> = {
  '(tabs)': null,
  login: null,
  'oauth/callback': null,
  'recording/[type]': null,
  routes: null,
  'sheets/activity-type': null,

  'activity/[id]': { overMap: true },
  'exercise/[category]': { titleKey: 'strength.history' },
  'route/[id]': { overMap: true },
  'section/[id]': { overMap: true },
  'section/laps/[id]': { titleKey: 'sections.laps' },
  'section/history/[id]': { titleKey: 'sectionHistory.title' },

  about: { titleKey: 'about.title' },
  account: { titleKey: 'settings.account' },
  'backup-settings': { titleKey: 'backup.autoBackup' },
  'best-efforts': { titleKey: 'bestEffortsScreen.title' },
  'cache-settings': { titleKey: 'settings.dataCache' },
  'data-sources-settings': { titleKey: 'settings.dataSources' },
  debug: { title: 'Developer Dashboard' },
  'detection-preview': { titleKey: 'settings.previewSections' },
  'detection-settings': { titleKey: 'settings.sectionDetection' },
  'display-settings': { titleKey: 'settings.display' },
  licenses: { titleKey: 'licenses.title' },
  'map-settings': { titleKey: 'settings.maps' },
  'named-corridors': { titleKey: 'namedCorridors.title' },
  'notification-settings': { titleKey: 'notifications.settings.title' },
  record: { titleKey: 'recording.startActivity' },
  'recording-settings': { titleKey: 'recording.settings' },
  'route-grouping-preview': { titleKey: 'settings.previewRouteGrouping' },
  'recording/review': { titleKey: 'recording.reviewActivity' },
  'recordings/[id]': { titleKey: 'recording.library.title', dynamic: true },
  'recordings/index': { titleKey: 'recording.library.title' },
  'section-retired': { titleKey: 'sectionHistory.retiredTitle' },
  'sensor-settings': { titleKey: 'sensors.title' },
  settings: { titleKey: 'settings.title' },
  'summary-card-settings': { titleKey: 'settings.summaryCard' },
  'sync-settings': { titleKey: 'settings.localDataRange' },
};

/**
 * The transition a root-stack route opens with. The tabs switch instantly. Every
 * other route takes the platform's own default. The stack sets no animation of
 * its own, so this is the only place a route's transition is chosen.
 */
export function screenAnimation(name: string): 'none' | 'default' {
  return name === '(tabs)' ? 'none' : 'default';
}

/**
 * Routes presented as a platform sheet, by name to the detents the sheet rests
 * at. Each is also listed in `SCREEN_HEADERS` as `null`, because a sheet draws
 * its own title row.
 */
export const SCREEN_SHEETS: Record<string, number[] | 'fitToContents'> = {
  'sheets/activity-type': [0.6, 1],
};

/** The stack options that make a listed route a sheet, or undefined for any other route. */
export function sheetScreenOptions(name: string) {
  const detents = SCREEN_SHEETS[name];
  if (!detents) return undefined;
  return {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    sheetAllowedDetents: detents,
    headerShown: false,
  };
}

/**
 * The tint of the platform's back control. White over a dark map hero, the
 * theme's primary text on any screen with no hero, where white would vanish
 * on the page background.
 */
export function overMapHeaderTint({ overHero, isDark }: { overHero: boolean; isDark: boolean }) {
  if (overHero) return colors.textOnDark;
  return isDark ? darkColors.textPrimary : colors.textPrimary;
}
