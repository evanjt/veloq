/**
 * The navigation chrome for every route the root stack owns, in one place.
 *
 * `null` is a screen that draws its own and takes no header: the tab group,
 * the two auth screens, the redirect, the full-screen recorder and the routes
 * list. The recorder's route turns the platform's header on itself when it
 * shows the manual or strength form, titled with the sport. Everything else
 * takes the platform's header, titled from one i18n key,
 * which is the rule in `src/shared/ui/CLAUDE.md`. The settings hub titles the
 * row that opens a screen from the same key, so the two never read differently. A screen has no header code
 * of its own. `overMap` is the header of a map-hero detail screen: transparent
 * and visually untitled, so the platform's back control floats over the hero.
 * A state of that screen with no hero to show takes the opaque header instead,
 * through `noHeroHeaderOptions`.
 *
 * The tab group's children are not root-stack routes, so their headers are in `TAB_HEADERS`.
 */

import type { ParseKeys } from 'i18next';

import { colors, colorWithOpacity, darkColors } from '@/theme';
import { layout } from '@/theme/spacing';

export interface ScreenHeader {
  /** i18n key for the title. Resolved in the layout, so the screen stays pure. */
  titleKey?: ParseKeys;
  /** Literal title, for the developer screen, which is not translated. */
  title?: string;
  /** The layout supplies a headerTitle of its own; the key above is what shows until it loads. */
  dynamic?: boolean;
  /** Transparent header with no visible title, laid over a full-bleed map hero. */
  overMap?: boolean;
  /**
   * Collapsing large title on iOS. Only a screen whose first child is its scroll view can take
   * one, so an entry sets it when its screen is ready. The rest stay small: a screen with a row
   * above its scroll view, one with no scroll view, and the three `overMap` entries, which are
   * transparent.
   */
  largeTitle?: boolean;
}

export const SCREEN_HEADERS: Record<string, ScreenHeader | null> = {
  '(tabs)': null,
  login: null,
  'oauth/callback': null,
  'recording/[type]': null,
  routes: null,
  'sheets/activity-type': null,
  'sheets/insight': null,
  'sheets/tile-cache-budget': null,
  'sheets/param-editor': null,
  'sheets/day-activities': null,
  'sheets/smoothing': null,
  'sheets/stat-detail': null,
  'sheets/chart-data': null,
  'sheets/strength-pairs-info': null,
  'sheets/field-picker': null,
  'sheets/route-overlay': null,
  'sheets/merge-candidates': null,
  'sheets/merge-confirm': null,
  'sheets/section-chooser': null,
  'sheets/explainer': null,

  'activity/[id]': { overMap: true },
  'exercise/[category]': { titleKey: 'strength.history', largeTitle: true },
  'route/[id]': { overMap: true },
  'section/[id]': { overMap: true },
  // No large title: on iOS 26 the lap list scrolled under a title that never collapsed.
  'section/laps/[id]': { titleKey: 'sections.laps' },
  'section/history/[id]': { titleKey: 'sectionHistory.title', largeTitle: true },

  about: { titleKey: 'about.title', largeTitle: true },
  account: { titleKey: 'settings.account', largeTitle: true },
  'backup-settings': { titleKey: 'backup.title', largeTitle: true },
  'best-efforts': { titleKey: 'bestEffortsScreen.title' },
  'cache-settings': { titleKey: 'settings.storage', largeTitle: true },
  'data-sources-settings': { titleKey: 'settings.dataSources', largeTitle: true },
  // No large title: on iOS 26 the dashboard scrolled under a title that never collapsed.
  debug: { title: 'Developer dashboard' },
  'detection-preview': { titleKey: 'settings.previewSections' },
  'detection-settings': { titleKey: 'settings.routesAndSections', largeTitle: true },
  'display-settings': { titleKey: 'settings.display', largeTitle: true },
  licenses: { titleKey: 'licenses.title', largeTitle: true },
  'map-settings': { titleKey: 'settings.maps', largeTitle: true },
  'named-corridors': { titleKey: 'namedCorridors.title', largeTitle: true },
  'notification-settings': { titleKey: 'notifications.settings.title', largeTitle: true },
  record: { titleKey: 'recording.startActivity' },
  'recording-settings': { titleKey: 'recording.settings', largeTitle: true },
  'route-grouping-preview': { titleKey: 'settings.previewRouteGrouping' },
  'recording/review': { titleKey: 'recording.reviewActivity', largeTitle: true },
  'recordings/[id]': { titleKey: 'recording.library.title', dynamic: true },
  'recordings/index': { titleKey: 'recording.library.title', largeTitle: true },
  'section-retired': { titleKey: 'sectionHistory.retiredTitle', largeTitle: true },
  'sensor-settings': { titleKey: 'sensors.title', largeTitle: true },
  'summary-card-settings': { titleKey: 'settings.summaryCard', largeTitle: true },
  'sync-settings': { titleKey: 'settings.localDataRange', largeTitle: true },
};

/**
 * The header of each tab root, by the name the tab group registers it under. A headered tab is a
 * stack of one screen, so the platform draws its title, its trailing items and its search field
 * the way it draws every other screen's. `null` is the map, which is full-bleed under its own
 * controls. The Feed and Insights keep a small title: the Feed's pinned cards and the Insights
 * page strip sit above their scroll views.
 */
export const TAB_HEADERS: Record<string, ScreenHeader | null> = {
  '(feed)': { titleKey: 'navigation.feed' },
  fitness: { titleKey: 'navigation.fitness', largeTitle: true },
  map: null,
  insights: { titleKey: 'insights.title' },
  settings: { titleKey: 'settings.title', largeTitle: true },
};

/** The title a header shows: the literal one, else its key translated, else none. */
export function headerTitleOf(
  header: ScreenHeader | null | undefined,
  t: (key: ParseKeys) => string
): string {
  return header?.title ?? (header?.titleKey ? t(header.titleKey) : '');
}

/**
 * The title of each tab, by its route name in `(tabs)/_layout`. The tab group's entry in the root
 * stack takes the focused tab's title, which is what the next screen's back control is named
 * after.
 */
export const TAB_TITLE_KEYS: Record<string, ParseKeys> = {
  '(feed)': 'navigation.feed',
  fitness: 'navigation.fitness',
  map: 'navigation.map',
  insights: 'navigation.insights',
  settings: 'navigation.settings',
};

/**
 * The colour an over-map header draws its title in: the least alpha a colour can carry, which the
 * eye cannot see. Not fully transparent, because that packs to 0 and the Android header reads a
 * title colour of 0 as unset and draws its default colour instead.
 */
export const OVER_MAP_TITLE_COLOR = colorWithOpacity(colors.textOnFill, 1 / 255);

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
 * its title row with `SheetHeader` from `src/shared/ui`.
 */
export const SCREEN_SHEETS: Record<string, number[] | 'fitToContents'> = {
  'sheets/activity-type': [0.6, 1],
  'sheets/insight': [0.5, 1],
  'sheets/tile-cache-budget': 'fitToContents',
  'sheets/param-editor': [0.6, 1],
  'sheets/day-activities': 'fitToContents',
  'sheets/smoothing': 'fitToContents',
  'sheets/stat-detail': 'fitToContents',
  'sheets/chart-data': [0.6, 1],
  'sheets/strength-pairs-info': 'fitToContents',
  'sheets/field-picker': [0.6, 1],
  'sheets/route-overlay': [0.6, 1],
  'sheets/merge-candidates': [0.6, 1],
  'sheets/merge-confirm': [0.6, 1],
  'sheets/section-chooser': 'fitToContents',
  'sheets/explainer': 'fitToContents',
};

/** The height the map sheet's lowest stop shows above the bottom inset: the title and key stats. */
const MAP_SHEET_PEEK = 150;
/** The map sheet's resting stop, as a fraction of the window. */
const MAP_SHEET_HALF = 0.52;
/** The strip of map the map sheet leaves above itself at its highest stop. */
const MAP_SHEET_STRIP = 72;
/** The least gap between two stops, so a window too short for the sizes above keeps three. */
const MAP_SHEET_MIN_STEP = 0.05;

/** The map sheet's three stops as fractions of the window, low to high, or null with no window. */
function mapSheetFractions(
  windowHeight: number,
  bottomInset: number
): [number, number, number] | null {
  if (windowHeight <= 0) return null;
  const peek = Math.min(
    (MAP_SHEET_PEEK + bottomInset) / windowHeight,
    MAP_SHEET_HALF - MAP_SHEET_MIN_STEP
  );
  const full = Math.min(
    Math.max((windowHeight - MAP_SHEET_STRIP) / windowHeight, MAP_SHEET_HALF + MAP_SHEET_MIN_STEP),
    1
  );
  return [peek, MAP_SHEET_HALF, full];
}

/**
 * The three stops a map screen's data sheet rests at, low to high, as fractions of the window,
 * with the height of map left visible above the sheet at each. Peek shows its row clear of the
 * bottom inset, because the sheet runs under the navigation bar and the frame pads it. A window
 * too short for those sizes still gets three ascending stops, and one with no height yet gets
 * none.
 */
export function sheetStops(
  windowHeight: number,
  bottomInset: number
): { detents: number[]; visibleMap: number[] } {
  const detents = mapSheetFractions(windowHeight, bottomInset) ?? [];
  return { detents, visibleMap: detents.map((detent) => windowHeight * (1 - detent)) };
}

/**
 * Whether the system draws the sheet's background itself. iOS 26 gives a form sheet a
 * translucent material that follows the colour scheme, and an opaque fill laid over it stops
 * short of the sheet's bottom edge and leaves a seam where the material shows below it.
 */
function sheetHasSystemMaterial(os: string, osVersion: string | number): boolean {
  return os === 'ios' && parseInt(String(osVersion), 10) >= 26;
}

/**
 * The stack options that make a listed route a sheet, or undefined for any other route.
 *
 * The grabber is iOS only. Android's sheet defaults to square top corners, so it takes
 * Material's extra-large radius there, and iOS keeps the system's own corners. Where the
 * system draws the sheet's material, the container is cleared so the stack's theme background
 * does not cover it; elsewhere the theme background stays.
 */
export function sheetScreenOptions(name: string, os: string, osVersion: string | number) {
  const detents = SCREEN_SHEETS[name];
  if (!detents) return undefined;
  return sheetOptions(detents, os, osVersion);
}

/**
 * The stack options of a map screen's data sheet: the sheet edges every other sheet takes, at
 * the three stops of `sheetStops`, opened at the middle one. No stop dims what is behind, so the
 * map under the sheet stays lit and takes its gestures at every stop. The dismiss gesture is
 * off, so a drag stops at the lowest stop and back is what leaves.
 *
 * The Android sheet sizes its middle detent as that detent over the highest, of the whole
 * window, and its highest below the top inset unless told to overflow it. So Android is given
 * the middle stop scaled by the highest, and overflows the inset, which puts all three where
 * `sheetStops` says. iOS takes the stops as they are.
 */
export function mapSheetScreenOptions(
  os: string,
  osVersion: string | number,
  windowHeight: number,
  bottomInset: number
) {
  const stops = mapSheetFractions(windowHeight, bottomInset);
  const android = os === 'android' && stops !== null;
  const detents = !stops ? [] : android ? [stops[0], stops[1] * stops[2], stops[2]] : stops;
  return {
    ...sheetOptions(detents, os, osVersion),
    sheetInitialDetentIndex: 1,
    sheetLargestUndimmedDetentIndex: 'last' as const,
    gestureEnabled: false,
    ...(android && { sheetShouldOverflowTopInset: true }),
  };
}

function sheetOptions(detents: number[] | 'fitToContents', os: string, osVersion: string | number) {
  return {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    sheetAllowedDetents: detents,
    headerShown: false,
    ...(os === 'android' && { sheetCornerRadius: layout.borderRadiusXxl }),
    ...(sheetHasSystemMaterial(os, osVersion) && {
      contentStyle: { backgroundColor: 'transparent' },
    }),
  };
}

/**
 * The fill the shared sheet frame paints: the theme's surface, or none where the system draws
 * the sheet's material. The frame is a sheet route's only fill, so no route paints its own.
 */
export function sheetSurface(
  os: string,
  osVersion: string | number,
  isDark: boolean
): string | undefined {
  if (sheetHasSystemMaterial(os, osVersion)) return undefined;
  return isDark ? darkColors.surface : colors.surface;
}

/** Whether a sheet route rests at more than one detent, so it can be dragged between them. */
export function sheetHasDetents(name: string): boolean {
  const detents = SCREEN_SHEETS[name];
  return Array.isArray(detents) && detents.length > 1;
}

/**
 * What the shared sheet frame adds around a sheet route's content.
 *
 * Android's stack sheet draws no drag handle, so the frame draws Material's on a sheet that
 * can be dragged between detents, and none on one sized to its content. iOS draws its own
 * grabber. The Android sheet runs under the navigation bar whatever its detents, so every
 * one is padded by the bottom inset. On iOS a sheet sized to its content already ends above
 * the home indicator, and only a resizable one, which reaches the screen's bottom edge, is
 * padded.
 */
export function sheetFrame(
  name: string,
  os: string,
  bottomInset: number
): { handle: boolean; paddingBottom: number } {
  const resizable = sheetHasDetents(name);
  if (os === 'android') return { handle: resizable, paddingBottom: bottomInset };
  return { handle: false, paddingBottom: resizable ? bottomInset : 0 };
}

/**
 * Whether a route's header is a large title. Only iOS has one, only an entry that sets
 * `largeTitle` takes it, and a transparent `overMap` header or a `dynamic` custom title never does.
 */
export function headerLargeTitle(
  name: string,
  os: string,
  headers: Record<string, ScreenHeader | null> = SCREEN_HEADERS
): boolean {
  const header = headers[name];
  if (os !== 'ios' || !header?.largeTitle) return false;
  return !header.overMap && !header.dynamic;
}

/**
 * The large-title options a route passes to the stack. iOS 26 draws an opaque bar over its own
 * large title, so the large-title appearance is made transparent, the one form that keeps the
 * title visible. The collapsed bar keeps the stack's opaque surface, so content never scrolls
 * under a bare title on the earlier systems.
 */
export function largeTitleScreenOptions(
  name: string,
  os: string,
  headers: Record<string, ScreenHeader | null> = SCREEN_HEADERS
): { headerLargeTitle: boolean; headerLargeStyle?: { backgroundColor: 'transparent' } } {
  if (!headerLargeTitle(name, os, headers)) return { headerLargeTitle: false };
  return { headerLargeTitle: true, headerLargeStyle: { backgroundColor: 'transparent' } };
}

/**
 * The chrome of a map-hero detail screen: the tint of the platform's back control, the status
 * bar's glyph style and the header's background, answered together so they never disagree. Over
 * the hero the bar is transparent and its glyphs white, held by the hero's top scrim on any
 * basemap. Once the hero has scrolled away the page passes under the bar, so it takes the theme's
 * surface and text, and the status bar the style that reads on that surface. A screen with no
 * hero is in the scrolled state from the start.
 */
export function mapHeroChrome({
  scrolledPastHero,
  isDark,
}: {
  scrolledPastHero: boolean;
  isDark: boolean;
}): { tint: string; statusBarStyle: 'light' | 'dark'; headerBackgroundColor: string } {
  if (!scrolledPastHero) {
    return {
      tint: colors.textOnFill,
      statusBarStyle: 'light',
      headerBackgroundColor: 'transparent',
    };
  }
  return {
    tint: isDark ? darkColors.textPrimary : colors.textPrimary,
    statusBarStyle: isDark ? 'light' : 'dark',
    headerBackgroundColor: isDark ? darkColors.surface : colors.surface,
  };
}

/**
 * Whether a hero at the top of a scroll view has scrolled out from under the header: true once
 * its bottom edge reaches the header's bottom edge, `headerBottom` being the top inset plus the
 * header's height.
 */
export function heroScrolledPast(offsetY: number, heroHeight: number, headerBottom: number) {
  return offsetY >= heroHeight - headerBottom;
}

/**
 * The stack header's own options: the theme surface behind it, the theme text for its controls,
 * and each platform's own title metrics. The Material 3 top app bar is flat at rest, so Android
 * draws no toolbar shadow; iOS keeps its bar's separator.
 */
export function stackHeaderOptions(os: string, isDark: boolean) {
  const chrome = mapHeroChrome({ scrolledPastHero: true, isDark });
  return {
    headerShadowVisible: os !== 'android',
    headerStyle: { backgroundColor: chrome.headerBackgroundColor },
    headerTintColor: chrome.tint,
  };
}

/**
 * The header of a map-hero detail screen while it shows its hero: a transparent bar with a title
 * nobody can see. The native stack hands a string `headerTitle` to the native item in place of
 * `title`, so neither this nor the route sets one, and the screen's `title` is its subject's name
 * once the read has it. Both screen readers then find the screen's name in its header and iOS
 * names the next screen's back control after it, while nothing is drawn over the hero. Once the
 * hero has scrolled away the bar stays laid over the page, so nothing under it moves, and takes
 * the colours `mapHeroChrome` gives that state.
 */
export function overMapHeaderOptions({
  title,
  isDark,
  scrolledPastHero = false,
}: {
  title?: string | undefined;
  isDark: boolean;
  scrolledPastHero?: boolean;
}) {
  const chrome = mapHeroChrome({ scrolledPastHero, isDark });
  return {
    headerTransparent: true,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: chrome.headerBackgroundColor },
    headerTitleStyle: { color: OVER_MAP_TITLE_COLOR },
    headerTintColor: chrome.tint,
    ...(title !== undefined && { title }),
  };
}

/**
 * The header of a map-hero detail screen in a state with no hero: the opaque platform header in
 * the theme, as the stack draws it, so content starts directly under it. With a title it names
 * the screen; without one the route keeps the title it has. It sets every option
 * `overMapHeaderOptions` does, because options a screen sets outlast the state that set them.
 */
export function noHeroHeaderOptions({
  title,
  isDark,
  os,
}: {
  title?: string | undefined;
  isDark: boolean;
  os: string;
}) {
  const themed = stackHeaderOptions(os, isDark);
  return {
    headerTransparent: false,
    ...themed,
    headerTitleStyle: { color: themed.headerTintColor },
    ...(title !== undefined && { title }),
  };
}
