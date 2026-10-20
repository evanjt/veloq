/**
 * The host of a map detail screen: a nested stack the screen's route owns, holding the map
 * screen and the sheet screen over it, so popping the route takes the map and its sheet together.
 *
 * The route registered on the root stack (`route/[id]`) keeps its transparent header, whose round
 * back chip floats over the map. Inside, `index` is the full-window map and `sheet` the form sheet
 * from `mapSheetScreenOptions`, which the map screen presents on mount at Half. At regular width
 * there is no sheet: the map screen draws the same card in a side panel at its leading edge, and
 * the nested stack holds the map screen alone. The host opens the per-screen entry of
 * `mapSheetHost` while it is mounted.
 *
 * Focus is the host route's, not a nested screen's: inside the nested stack the map screen loses
 * focus to its own sheet, which covers nothing the map needs released for. Only another screen
 * of the root stack pushed over the host takes it.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BackHandler, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Stack, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { StackActions, useNavigationState } from 'expo-router/react-navigation';

import { MapHeroStatusBar } from './MapHeroStatusBar';
import {
  closeHost,
  mapSheetHostKey,
  openHost,
  useHostCardCount,
  type MapSheetCardKind,
  type MapSheetKind,
} from './mapSheetHost';
import { MAP_SHEET_HALF_STOP, useMapSheetStop } from './mapSheetStop';
import { mapSheetPanelWidth, mapSheetScreenOptions, sheetSurface } from './screenHeaders';
import { useSheetWindow } from './TopSafeAreaContext';
import { useTheme } from './useTheme';
import { BACK_SWIPE_EDGE_WIDTH } from '@/shared/ui/backSwipeEdge';
import { MapSheetHandle } from '@/shared/ui/MapSheetHandle';
import { useHeroHeaderBottom } from '@/shared/ui/useHeroHeaderBottom';
import { colors, darkColors, stroke } from '@/theme';

/** The name of the nested stack's sheet screen, beside its `index` map screen. */
export const MAP_SHEET_SCREEN = 'sheet';

export interface MapSheetHostValue {
  kind: MapSheetKind;
  id: string;
  /** The key of the host's entry in `mapSheetHost`, `<kind>:<id>`. */
  key: string;
  /** Whether the host route is the root stack's focused one. */
  focused: boolean;
  /** Sets the host route's header options on the root stack, the title among them. */
  setHeaderOptions: (options: object) => void;
  /**
   * Tells the host its map screen draws no map, for a subject with nothing to show on one, so the
   * status bar takes the theme's glyphs rather than the light ones it draws over a map.
   */
  setMapless?: (mapless: boolean) => void;
}

export const MapSheetHostContext = createContext<MapSheetHostValue | null>(null);

/** The host a screen renders inside, or null outside one. */
export function useMapSheetHost(): MapSheetHostValue | null {
  return useContext(MapSheetHostContext);
}

/**
 * Whether a map should be held: the host route's focus inside a host, the screen's own focus
 * anywhere else. A map released whenever its own screen lost focus would go black under its sheet.
 */
export function useMapHeldFocus(): boolean {
  const host = useContext(MapSheetHostContext);
  const screenFocused = useIsFocused();
  return host ? host.focused : screenFocused;
}

/** The card of a host's sheet a component renders inside: where it sits in the stack. */
export interface MapSheetCardValue {
  /** The key of the host's entry the card belongs to. */
  hostKey: string;
  /** The card's place in the stack, the root at 0. */
  index: number;
  /** Whether the card is the one on show. */
  onTop: boolean;
  /** Whether a subject of this kind opens as a card in this host's sheet. */
  opens: (kind: MapSheetCardKind) => boolean;
}

export const MapSheetCardContext = createContext<MapSheetCardValue | null>(null);

/** The card a component renders inside, or null outside a host's card stack. */
export function useMapSheetCard(): MapSheetCardValue | null {
  return useContext(MapSheetCardContext);
}

/**
 * Where a card of `kind` and `id` writes its state: its own place in the host's stack, the root
 * of the host it sits in when it is drawn outside the stack, or a root of its own outside a host.
 */
export function useMapSheetCardAddress(
  kind: MapSheetKind,
  id: string
): { hostKey: string; index: number } {
  const card = useContext(MapSheetCardContext);
  const hostKey = useContext(MapSheetHostContext)?.key;
  return useMemo(
    () =>
      card
        ? { hostKey: card.hostKey, index: card.index }
        : { hostKey: hostKey ?? mapSheetHostKey(kind, id), index: 0 },
    [card, hostKey, kind, id]
  );
}

/**
 * Sets the host route's header options while the caller is mounted inside a host, unless null.
 * Inside a card stack only the card on show sets them, and sets them again when a pop shows it.
 */
export function useMapSheetHostHeader(options: object | null): void {
  const setHeaderOptions = useContext(MapSheetHostContext)?.setHeaderOptions;
  const shown = useContext(MapSheetCardContext)?.onTop ?? true;
  useEffect(() => {
    if (options && shown) setHeaderOptions?.(options);
  }, [setHeaderOptions, options, shown]);
}

/**
 * Opens the host's entry for as long as the caller is mounted. The first open is made in the state
 * initialiser, before the first render's children read or write the entry, since a child's
 * effects run before its parent's. The effect opens any later key and the remount Strict Mode
 * makes, and every cleanup closes what its run held.
 */
export function useMapSheetHostEntry(kind: MapSheetKind, id: string): string {
  const key = mapSheetHostKey(kind, id);
  const [openedFirst] = useState(() => {
    openHost(kind, id);
    return key;
  });
  const firstOpenTaken = useRef(false);
  useEffect(() => {
    if (!firstOpenTaken.current && key === openedFirst) firstOpenTaken.current = true;
    else openHost(kind, id);
    return () => closeHost(key);
  }, [kind, id, key, openedFirst]);
  return key;
}

function stopParam(params: unknown): number {
  const stop = Number((params as { stop?: unknown } | undefined)?.stop);
  return Number.isInteger(stop) ? stop : MAP_SHEET_HALF_STOP;
}

/** The layout a map detail route's directory exports, for its kind. */
export function createMapSheetHostLayout(kind: MapSheetKind) {
  function MapSheetHostLayout() {
    const { id = '' } = useLocalSearchParams<{ id: string }>();
    const key = useMapSheetHostEntry(kind, id);
    const focused = useIsFocused();
    const navigation = useNavigation();
    const { isDark } = useTheme();
    const sheetWindow = useSheetWindow();
    const { onDetentChanged } = useMapSheetStop(key);
    const [mapless, setMapless] = useState(false);

    const setHeaderOptions = useCallback(
      (options: object) => navigation.setOptions(options),
      [navigation]
    );
    const host = useMemo<MapSheetHostValue>(
      () => ({ kind, id, key, focused, setHeaderOptions, setMapless }),
      [id, key, focused, setHeaderOptions]
    );
    const sheetOptions = mapSheetScreenOptions(Platform.OS, Platform.Version, sheetWindow);

    return (
      <MapSheetHostContext.Provider value={host}>
        <MapHeroStatusBar scrolledPastHero={mapless} isDark={isDark} />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen
            name={MAP_SHEET_SCREEN}
            options={({ route }: { route: { params?: unknown } }) =>
              sheetOptions.presentation === 'formSheet'
                ? { ...sheetOptions, sheetInitialDetentIndex: stopParam(route.params) }
                : sheetOptions
            }
            listeners={{
              sheetDetentChange: (event: { data?: { index: number; stable: boolean } }) => {
                if (event.data)
                  onDetentChanged({ index: event.data.index, isStable: event.data.stable });
              },
            }}
          />
        </Stack>
      </MapSheetHostContext.Provider>
    );
  }
  MapSheetHostLayout.displayName = `MapSheetHostLayout(${kind})`;
  return MapSheetHostLayout;
}

/** The side panel's width on this window, or null where the data is a sheet. */
export function useMapSheetPanelWidth(): number | null {
  const { width } = useWindowDimensions();
  return mapSheetPanelWidth({ width });
}

/**
 * The host's map screen: the map filling the window, the sheet presented over it on mount with
 * the params the screen was opened with, and again whenever a navigation inside the host shows the
 * map screen without it outside a tool, and the presenter the stop store moves the sheet
 * through, which takes the sheet away while a tool runs on the map. On iOS a plain strip over the
 * map's leading edge keeps the stack's edge swipe, which the map's pan would otherwise take.
 *
 * At regular width `panel` is drawn in a side panel over the map's leading edge instead, the full
 * height below the header, and no sheet is presented and no presenter registered, so nothing
 * moves a stop there. A window that crosses the width, such as a resized iPad window, presents
 * the sheet as it narrows and takes it down as it widens.
 */
export function MapSheetHostMap({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  const host = useMapSheetHost();
  const navigation = useNavigation();
  const panelWidth = useMapSheetPanelWidth();
  const docked = panelWidth !== null;
  const hostKey = host?.key ?? '';
  const params = useLocalSearchParams<Record<string, string>>();
  // The router hands a fresh params object on every render, so the sheet reads the latest from
  // here rather than the presenter being registered again each render.
  const sheetParams = useRef<object>(params);
  useEffect(() => {
    sheetParams.current = params;
  });

  // A push of the sheet dispatched and not yet in the stack this screen last rendered.
  const sheetPending = useRef(false);
  const present = useCallback(
    (stop: number | null) => {
      // Without the merge a pop to the map screen clears the params it was opened with, which
      // the sheet is presented with again.
      navigation.dispatch(StackActions.popTo('index', undefined, { merge: true }));
      sheetPending.current = stop !== null;
      if (stop === null) return;
      navigation.dispatch(StackActions.push(MAP_SHEET_SCREEN, { ...sheetParams.current, stop }));
    },
    [navigation]
  );
  const { toolActive } = useMapSheetStop(hostKey, docked ? undefined : present);
  const sheetKey = useNavigationState(
    (state) => state.routes.find((route) => route.name === MAP_SHEET_SCREEN)?.key ?? null
  );

  // The sheet cannot be dragged away, so the map screen without it on a phone is either a tool
  // running or a navigation inside the host that showed the map screen again, such as a link to
  // the subject already open, and that one presents the sheet again.
  useEffect(() => {
    if (sheetKey !== null) {
      sheetPending.current = false;
      if (docked) navigation.dispatch(StackActions.popTo('index'));
    } else if (!docked && !toolActive && !sheetPending.current) {
      sheetPending.current = true;
      navigation.dispatch(StackActions.push(MAP_SHEET_SCREEN, { ...sheetParams.current }));
    }
  }, [navigation, docked, sheetKey, toolActive]);

  return (
    <View testID="map-sheet-host-map" style={styles.fill}>
      {children}
      {docked ? (
        <MapSheetHostPanel width={panelWidth}>{panel}</MapSheetHostPanel>
      ) : (
        Platform.OS === 'ios' && (
          <View testID="map-sheet-back-edge" accessible={false} style={styles.backSwipeEdge} />
        )
      )}
    </View>
  );
}

/**
 * The side panel at regular width: the theme's surface, since no system sheet draws a material
 * behind it, from the bottom of the header floating over the map to the window's bottom edge,
 * with a hairline on its trailing edge where the map begins.
 */
function MapSheetHostPanel({ width, children }: { width: number; children: React.ReactNode }) {
  const { isDark } = useTheme();
  const headerBottom = useHeroHeaderBottom();
  const palette = isDark ? darkColors : colors;
  return (
    <View
      testID="map-sheet-panel"
      style={[
        styles.panel,
        {
          width,
          paddingTop: headerBottom,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The host's sheet screen: the sheet's fill, Android's drawn handle, and Android's system back.
 *
 * Android's back on the sheet would close only the sheet and leave the bare map, so while the
 * host is focused and its sheet holds only the root card, back leaves the host route instead.
 * Above the root, `MapSheetCards` takes back and pops the top card. It is a plain back handler rather than a hold on the sheet's removal, because a hold there would
 * also hold the host's own pop, which removes the sheet with it. iOS draws the system grabber,
 * which the athlete drags, and its back is the header chip and the edge swipe.
 */
export function MapSheetHostSheet({ children }: { children: React.ReactNode }) {
  const host = useMapSheetHost();
  const navigation = useNavigation();
  const { isDark } = useTheme();
  const cardCount = useHostCardCount(host?.key ?? '');
  const leavesHost = Platform.OS === 'android' && !!host?.focused && cardCount <= 1;

  useEffect(() => {
    if (!leavesHost) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.getParent()?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [leavesHost, navigation]);

  return (
    <View
      testID="map-sheet"
      style={[
        styles.fill,
        { backgroundColor: sheetSurface(Platform.OS, Platform.Version, isDark) },
      ]}
    >
      {Platform.OS === 'android' && host ? <MapSheetHandle sheetKey={host.key} drawn /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    start: 0,
    top: 0,
    bottom: 0,
    borderEndWidth: stroke.hairline,
  },
  backSwipeEdge: {
    position: 'absolute',
    start: 0,
    top: 0,
    bottom: 0,
    width: BACK_SWIPE_EDGE_WIDTH,
  },
});
