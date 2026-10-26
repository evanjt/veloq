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
  // No large title: on iOS 26 the dashboard scrolled under a title that never collapsed.
  debug: { title: 'Developer dashboard' },
  'detection-preview': { titleKey: 'settings.previewSections' },
  'detection-settings': { titleKey: 'settings.routesAndSections', largeTitle: true },
  'display-settings': { titleKey: 'settings.display', largeTitle: true },
  experimental: { titleKey: 'experimental.title', largeTitle: true },
  'garmin-connector': { titleKey: 'garmin.title', largeTitle: true },
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
 * controls. The Feed, Fitness and Insights keep a small title: the Feed's pinned cards and the
 * Fitness and Insights page strips sit above their scroll views, and a large title's translucent
 * bar would draw them under the status bar.
 */
export const TAB_HEADERS: Record<string, ScreenHeader | null> = {
  '(feed)': { titleKey: 'navigation.feed' },
  fitness: { titleKey: 'navigation.fitness' },
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

/**
 * Sheet routes whose root is their scroll view, drawn with `SheetScrollView`. The iOS form sheet
 * sizes a scroll view only when it is the first view of the sheet's content: one inside a wrapping
 * view gets the sheet's frame in that view's coordinates and is drawn out of sight, leaving the
 * sheet blank. So on iOS the shared frame draws no view around these routes and hands its fill and
 * padding to the scroll view instead.
 */
export const SCROLL_ROOT_SHEETS: ReadonlySet<string> = new Set([
  'sheets/insight',
  'sheets/chart-data',
  'sheets/merge-confirm',
]);

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
 * The narrowest window that takes the map sheet as a side panel: Material's medium width class,
 * which every iPad window and every Android tablet in portrait reaches and no phone in portrait
 * does. Detents and a map behind the sheet belong to compact width; at regular width a form
 * sheet is a centred card with no detents, so the data docks beside the map instead.
 */
const MAP_SHEET_PANEL_MIN_WINDOW = 600;
/**
 * The shortest window that takes it: Material's compact height class ends at 480 dp. A phone on
 * its side is wide enough and 440 pt or less tall, so it keeps its sheet, and turning it does
 * not mount the open screen again, which the full-screen chart's landscape lock would do.
 */
const MAP_SHEET_PANEL_MIN_HEIGHT = 480;
/** The side panel's width bounds, and the share of the window it takes between them. */
const MAP_SHEET_PANEL_MIN = 360;
const MAP_SHEET_PANEL_MAX = 400;
const MAP_SHEET_PANEL_SHARE = 0.4;

/**
 * The width of the side panel a map screen's data docks in at the window's leading edge, or null
 * on a compact window, where the data is the three-stop sheet. A window is compact when it is
 * narrow or short.
 */
export function mapSheetPanelWidth(window: Pick<SheetWindow, 'width' | 'height'>): number | null {
  if (window.width < MAP_SHEET_PANEL_MIN_WINDOW || window.height < MAP_SHEET_PANEL_MIN_HEIGHT) {
    return null;
  }
  return Math.round(
    Math.min(
      Math.max(window.width * MAP_SHEET_PANEL_SHARE, MAP_SHEET_PANEL_MIN),
      MAP_SHEET_PANEL_MAX
    )
  );
}

/** A window and the safe-area insets the system gives it, in points. */
export interface SheetWindow {
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
}

/*
 * The iOS sheet's geometry, measured on the iOS 26.2 simulator with a sheet given custom detents
 * of `maximumDetentValue * fraction`, which is how `react-native-screens` resolves them. The
 * largest height is the window less both insets, and less 10 more under a 20 pt status bar:
 * 860 of 956 on iPhone 17 Pro Max (insets 62, 34), 778 of 874 on iPhone 17 (62, 34), 810 of 912
 * on iPhone Air (68, 34), 734 of 812 on iPhone 11 Pro (44, 34) and 637 of 667 on iPhone SE
 * (20, 0). A detent's height leaves out the bottom inset, which the sheet adds below it. At the
 * largest height the sheet is attached to the window's edges, its top on the top inset. Below
 * it iOS 26 floats the sheet: its bottom 8 above the window's, and the whole sheet scaled by
 * the width less 8 each side over the width. Every top read on those phones is within half a
 * point of that. A detent under about 0.15 floats higher still, and no stop goes that low.
 */
const IOS_SHEET_STATUS_BAR_GAP = 10;
/** The largest top inset with a plain status bar, under which the sheet keeps its gap. */
const IOS_PLAIN_STATUS_BAR_MAX = 40;
const IOS_SHEET_FLOAT_MARGIN = 8;

function iosSheetFloats(osVersion: string | number): boolean {
  return parseInt(String(osVersion), 10) >= 26;
}

/** The iOS sheet's largest height, the `maximumDetentValue` its detents are fractions of. */
function iosSheetLargest(window: SheetWindow): number {
  const gap = window.topInset <= IOS_PLAIN_STATUS_BAR_MAX ? IOS_SHEET_STATUS_BAR_GAP : 0;
  return window.height - window.topInset - window.bottomInset - gap;
}

/** The scale a floating iOS sheet is drawn at, and its bottom edge's lift off the window's. */
function iosSheetFloat(osVersion: string | number, window: SheetWindow) {
  if (!iosSheetFloats(osVersion) || window.width <= 0) return { scale: 1, lift: 0 };
  const scale = (window.width - 2 * IOS_SHEET_FLOAT_MARGIN) / window.width;
  return { scale, lift: IOS_SHEET_FLOAT_MARGIN };
}

/** Where the top edge of an iOS sheet at this fraction of its largest height sits in the window. */
export function iosSheetTop(
  fraction: number,
  osVersion: string | number,
  window: SheetWindow
): number {
  const largest = iosSheetLargest(window);
  if (fraction >= 1) return window.height - window.bottomInset - largest;
  const { scale, lift } = iosSheetFloat(osVersion, window);
  return window.height - lift - scale * (fraction * largest + window.bottomInset);
}

/**
 * The fraction of its largest height that puts an iOS sheet's top edge at `top`, or 1, the
 * edge-attached sheet, where no floating sheet reaches that high.
 */
function iosSheetFraction(top: number, osVersion: string | number, window: SheetWindow): number {
  const { scale, lift } = iosSheetFloat(osVersion, window);
  const fraction =
    ((window.height - lift - top) / scale - window.bottomInset) / iosSheetLargest(window);
  return Math.min(Math.max(fraction, 0), 1);
}

/** The map sheet's stops as the detents the platform's sheet takes, or null where it has none. */
function mapSheetDetents(
  os: string,
  osVersion: string | number,
  window: SheetWindow
): number[] | null {
  if (mapSheetPanelWidth(window) !== null) return null;
  const stops = mapSheetFractions(window.height, window.bottomInset);
  if (!stops) return null;
  if (os === 'ios') {
    return stops.map((stop) => iosSheetFraction(window.height * (1 - stop), osVersion, window));
  }
  if (os === 'android') return [stops[0], stops[1] * stops[2], stops[2]];
  return stops;
}

/**
 * The three stops a map screen's data sheet rests at, low to high, as fractions of the window,
 * with the height of map left visible above the sheet at each. Peek shows its row clear of the
 * bottom inset, because the sheet runs under the navigation bar and the frame pads it. A window
 * too short for those sizes still gets three ascending stops, and one with no height yet gets
 * none. On iOS each stop is where the sheet actually rests, which at full is the edge-attached
 * sheet's top where the strip is higher than a floating sheet reaches.
 *
 * A regular-width window has no stops: the data is a side panel `panelWidth` wide at the leading
 * edge, the full height of the map, and `panelWidth` is null everywhere else.
 */
export function sheetStops(
  os: string,
  osVersion: string | number,
  window: SheetWindow
): { detents: number[]; visibleMap: number[]; panelWidth: number | null } {
  const panelWidth = mapSheetPanelWidth(window);
  const detents = mapSheetDetents(os, osVersion, window);
  if (!detents) return { detents: [], visibleMap: [], panelWidth };
  const stops = mapSheetFractions(window.height, window.bottomInset) ?? [];
  const visibleMap =
    os === 'ios'
      ? detents.map((fraction) => iosSheetTop(fraction, osVersion, window))
      : stops.map((stop) => window.height * (1 - stop));
  return { detents: visibleMap.map((map) => 1 - map / window.height), visibleMap, panelWidth };
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

/** The stack options of the map sheet route, as `mapSheetScreenOptions` gives them. */
export interface MapSheetScreenOptions {
  presentation: 'formSheet' | 'card';
  headerShown: boolean;
  gestureEnabled: boolean;
  sheetGrabberVisible: boolean;
  /** Absent on a card, since the stack reads an empty list as a sheet with no stop to open at. */
  sheetAllowedDetents?: number[] | 'fitToContents';
  sheetInitialDetentIndex?: number;
  sheetLargestUndimmedDetentIndex?: 'last';
  sheetShouldOverflowTopInset?: boolean;
  sheetCornerRadius?: number;
  contentStyle?: { backgroundColor: string };
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
 * `sheetStops` says. iOS takes each detent as a fraction of its largest sheet, so it is given
 * the fraction that puts the sheet's top edge on the stop.
 *
 * A regular-width window presents no sheet: the map screen draws the data in its side panel, so
 * the sheet route is a plain card with no detents and no grabber, which the host never pushes.
 */
export function mapSheetScreenOptions(
  os: string,
  osVersion: string | number,
  window: SheetWindow
): MapSheetScreenOptions {
  if (mapSheetPanelWidth(window) !== null) {
    return {
      presentation: 'card',
      headerShown: false,
      gestureEnabled: false,
      sheetGrabberVisible: false,
    };
  }
  const detents = mapSheetDetents(os, osVersion, window);
  const android = os === 'android' && detents !== null;
  return {
    ...sheetOptions(detents ?? [], os, osVersion),
    sheetInitialDetentIndex: 1,
    sheetLargestUndimmedDetentIndex: 'last' as const,
    gestureEnabled: false,
    ...(android && { sheetShouldOverflowTopInset: true }),
  };
}

/**
 * The top corner radius of a sheet. Android is given it; iOS draws its own corners, which this
 * stands for where something has to keep clear of them.
 */
export const SHEET_CORNER_RADIUS = layout.borderRadiusXxl;

function sheetOptions(detents: number[] | 'fitToContents', os: string, osVersion: string | number) {
  return {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    sheetAllowedDetents: detents,
    headerShown: false,
    ...(os === 'android' && { sheetCornerRadius: SHEET_CORNER_RADIUS }),
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
 * padded. `wraps` is false for a route in `SCROLL_ROOT_SHEETS` on iOS, where the frame draws no
 * view of its own and its scroll view takes the fill and the padding.
 */
export function sheetFrame(
  name: string,
  os: string,
  bottomInset: number
): { handle: boolean; paddingBottom: number; wraps: boolean } {
  const resizable = sheetHasDetents(name);
  if (os === 'android') return { handle: resizable, paddingBottom: bottomInset, wraps: true };
  return {
    handle: false,
    paddingBottom: resizable ? bottomInset : 0,
    wraps: !SCROLL_ROOT_SHEETS.has(name),
  };
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
 * draws no toolbar shadow; iOS keeps its bar's separator. Android's native header applies the
 * status bar inset itself, whatever the JavaScript insets read, so while a banner in the top slot
 * has already padded the status bar the header is told to leave it alone.
 */
export function stackHeaderOptions(os: string, isDark: boolean, topSlotFilled = false) {
  const chrome = mapHeroChrome({ scrolledPastHero: true, isDark });
  return {
    headerShadowVisible: os !== 'android',
    headerStyle: { backgroundColor: chrome.headerBackgroundColor },
    headerTintColor: chrome.tint,
    ...(os === 'android' &&
      topSlotFilled && {
        unstable_nativeProps: { headerConfig: { disableTopInsetApplication: true } },
      }),
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
