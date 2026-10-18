import {
  brand,
  colorWithOpacity,
  colors,
  darkColors,
  ink,
  mapLayerColors,
  opacity,
  recording,
  routePalette,
  sectionPalette,
} from './colors';
import { colourTokens } from './colourTokens.generated';

/**
 * Every role both themes define, resolved for one of them. A style that reads
 * its colour from here cannot fall back to the light value in the dark theme by
 * leaving a branch out, which is what a static `colors.<role>` does.
 */
export type Palette = { readonly [K in keyof typeof colors & keyof typeof darkColors]: string };

export function themePalette(isDark: boolean): Palette {
  return isDark ? darkColors : colors;
}

const built = new WeakMap<object, { light?: unknown; dark?: unknown }>();

/**
 * The styles `make` builds from the active theme's palette, built once per theme
 * and kept, so a component calling this on every render allocates nothing.
 */
export function themedStyles<T>(
  make: (palette: Palette, isDark: boolean) => T,
  isDark: boolean
): T {
  let entry = built.get(make);
  if (!entry) {
    entry = {};
    built.set(make, entry);
  }
  const key = isDark ? 'dark' : 'light';
  if (!(key in entry)) entry[key] = make(themePalette(isDark), isDark);
  return entry[key] as T;
}

/** The base map a surface draws: the athlete picks it apart from the app theme. */
export type MapBase = 'light' | 'dark' | 'satellite';

/** A step of a base map's diverging ramp, from the cool end to the warm end. */
export type MapDivStep = 'cool-3' | 'cool-2' | 'cool-1' | 'mid' | 'warm-1' | 'warm-2' | 'warm-3';

const DIV_STEPS: readonly MapDivStep[] = [
  'cool-3',
  'cool-2',
  'cool-1',
  'mid',
  'warm-1',
  'warm-2',
  'warm-3',
];

/**
 * The colours every map layer builder draws with today, before the token roles
 * replace them key by key. They are the same on every base except where a key
 * says otherwise, so moving a builder onto the palette moves no colour.
 */
function layerColours(base: MapBase) {
  const dark = base !== 'light';
  return {
    ...mapLayerColors,
    /** Section lines and markers, indexed by the section's palette index. */
    sections: sectionPalette as readonly string[],
    /** Route lines, indexed by the engine's hash of the route id. */
    routes: routePalette as readonly string[],
    /** The sections the catalogue holds now, under a preview of a regroup. */
    current: colors.iconMuted,
    removed: colors.dangerFill,
    added: colors.successFill,
    proposed: brand.blue600,
    merging: colors.warningFill,
    /** The ring around an activity point that is not selected. */
    pointRing: colorWithOpacity(ink.white, 0.8),
    /** The selected activity's route while the heatmap is drawn under it. */
    heatmapRoute: ink.white,
    /** The legs from a spread cluster to its points, drawn for the base under them. */
    spiderLeg: dark
      ? colorWithOpacity(ink.white, opacity.disabled)
      : colorWithOpacity(ink.black, opacity.tint4),
    /** The live recording's line, read for the app theme the recording screen draws in. */
    recording,
    recordingOverlay: brand.blue,
    recordingExcluded: colorWithOpacity(colors.iconMuted, opacity.disabled),
    position: colors.secondary,
    positionHalo: colors.surface,
  };
}

export type MapLayerColours = ReturnType<typeof layerColours>;

interface MapPaletteCommon {
  base: MapBase;
  /** Whether the base is a dark ground, which is the theme its own colours read for. */
  isDark: boolean;
  route: string;
  casing: string;
  muted: string;
  ink: string;
  start: string;
  edge: string;
  location: string;
  /** The location dot's ring, white on every base. */
  locationRing: string;
  record: string;
  removed: string;
  badgeInk: string;
  /** The seven steps of the base's diverging ramp. */
  div: Readonly<Record<MapDivStep, string>>;
  /** The five heat steps, faintest first. */
  heat: readonly [string, string, string, string, string];
  sky: string;
  horizon: string;
  fog: string;
  /** The app palette for the base's own theme: dark on the dark and satellite bases. */
  theme: Palette;
  layer: MapLayerColours;
}

/** A vector base, which draws its own ground and labels and shades its relief. */
export interface VectorMapPalette extends MapPaletteCommon {
  base: 'light' | 'dark';
  land: string;
  park: string;
  water: string;
  road: string;
  label: string;
  hillshade: { highlight: string; shadow: string };
}

/** Satellite is imagery, so it has no ground, label or relief colour of its own. */
export interface SatelliteMapPalette extends MapPaletteCommon {
  base: 'satellite';
}

export type MapPalette = VectorMapPalette | SatelliteMapPalette;

// Map tokens are keyed by base rather than by theme, so either theme's table
// holds the same value for a keyed token.
const token = (name: string): string => {
  const value = (colourTokens.light as Record<string, string>)[name];
  if (value === undefined) throw new Error(`mapPalette: no colour token ${name}`);
  return value;
};

function buildMapPalette(base: MapBase): MapPalette {
  const role = (name: string) => token(`map-${base}-${name}`);
  const isDark = base !== 'light';
  const common: MapPaletteCommon = {
    base,
    isDark,
    route: role('route'),
    casing: role('casing'),
    muted: role('muted'),
    ink: role('ink'),
    start: role('start'),
    edge: role('edge'),
    location: role('location'),
    locationRing: ink.white,
    record: role('record'),
    removed: role('removed'),
    badgeInk: role('badge-ink'),
    div: Object.fromEntries(DIV_STEPS.map((step) => [step, role(`div-${step}`)])) as Record<
      MapDivStep,
      string
    >,
    heat: [role('heat-1'), role('heat-2'), role('heat-3'), role('heat-4'), role('heat-5')],
    sky: role('sky'),
    horizon: role('horizon'),
    fog: role('fog'),
    theme: themePalette(isDark),
    layer: layerColours(base),
  };
  if (base === 'satellite') return { ...common, base };
  return {
    ...common,
    base,
    land: role('land'),
    park: role('park'),
    water: role('water'),
    road: role('road'),
    label: role('label'),
    hillshade: { highlight: role('hillshade-highlight'), shadow: role('hillshade-shadow') },
  };
}

const mapPalettes: Record<MapBase, MapPalette> = {
  light: buildMapPalette('light'),
  dark: buildMapPalette('dark'),
  satellite: buildMapPalette('satellite'),
};

/**
 * Every colour a map layer draws, for the base map under it. A surface passes
 * the palette for the base it draws, which `useDrawnMapStyle` resolves with the
 * offline stand-in applied, so the colours switch with the base and never with
 * the app theme.
 */
export function mapPalette(base: 'satellite'): SatelliteMapPalette;
export function mapPalette(base: 'light' | 'dark'): VectorMapPalette;
export function mapPalette(base: MapBase): MapPalette;
export function mapPalette(base: MapBase): MapPalette {
  return mapPalettes[base];
}

/**
 * A MapLibre `match` from an index property to one of `colours`. A `match`
 * rather than `literal` and `at`, because MapLibre coerces a hex string to a
 * colour only in a direct position.
 */
export function colourIndexExpression(
  colours: readonly string[],
  index: unknown,
  modulo = false
): unknown {
  const branches: unknown[] = [];
  colours.forEach((colour, i) => branches.push(i, colour));
  const key = modulo ? ['%', index, colours.length] : index;
  return ['match', key, ...branches, colours[0]];
}
