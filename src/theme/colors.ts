/**
 * Veloq Premium Color Palette
 *
 * Primary: Blue (mode-aware) - everyday interactions, the icon's hue
 * Accent: Gold - achievements, celebrations, PRs only
 * Secondary: Blue - charts, data visualization
 *
 * Aesthetic: Premium/Luxury, Whoop-inspired, Dark-mode-first
 */

import appColours from './appColours.json';
import { colourTokens, roleColours, type ColourToken } from './colourTokens.generated';

/**
 * Creates a color with opacity from a hex color
 */
export function colorWithOpacity(hex: string, opacity: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * The colour `t` of the way from one six-digit hex colour to another, as hex. A
 * `t` past 1 carries on beyond `to`, each channel clamped to 0 to 255.
 */
export function mixColour(from: string, to: string, t: number): string {
  const a = parseInt(from.replace('#', ''), 16);
  const b = parseInt(to.replace('#', ''), 16);
  const channel = (shift: number) => {
    const low = (a >> shift) & 0xff;
    const high = (b >> shift) & 0xff;
    return Math.max(0, Math.min(255, Math.round(low + (high - low) * t)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

// =============================================================================
// FIXED INK
// =============================================================================

// White and black, for surfaces that are not the theme's: text on a coloured
// chip, a casing under a map line, a gradient built from one at an opacity.
// Reach for a semantic token first; this is the escape hatch, not the default.
export const ink = {
  white: '#FFFFFF',
  black: '#000000',
} as const;

// =============================================================================
// BRAND SIGNATURE COLORS
// =============================================================================

// The steps of the token file's blue and gold ramps the palette is built on.
// The app colour and the light primary are also drawn by native code before any
// JavaScript runs, so the same generator writes them to appColours.json, which
// app.config.js and the icon generator read.
const step = colourTokens.light;
export const brand = {
  // The action blue (buttons, links, selected and on states). White reads
  // 6.03:1 on blue600 and 4.93:1 on blue550, so a filled control is labelled
  // in white in both themes. blue550 is the dark theme's step: it holds 3:1
  // as a mark on the dark surfaces, where blue600 does not.
  blue600: step['blue-600'],
  blue550: step['blue-550'],
  blue700: step['blue-700'],

  // Gold - Accent (achievements, PRs, celebrations ONLY)
  gold: step['gold-400'],
  goldLight: step['gold-300'],
  goldDark: step['gold-500'],

  // Blue - Secondary (charts, data visualization). blueLight is also the
  // dark theme's link step.
  blue: step['blue-400'],
  blueLight: step['blue-300'],
  blueDark: step['blue-500'],
} as const;

// Colours native code also draws, read from the same file. `notificationAccent`
// is the LED colour an Android notification channel asks for.
export const nativeColours = {
  notificationAccent: appColours.notificationAccent,
} as const;

// Effort ramp for the RPE slider (easy to maximal, 1-10 mapped in pairs).
export const rpeRamp = [
  '#22C55E', // green, RPE 1-2
  '#84CC16', // lime, RPE 3-4
  '#EAB308', // yellow, RPE 5-6
  '#F97316', // orange, RPE 7-8
  '#EF4444', // red, RPE 9-10
] as const;

type Tokens = Readonly<Record<ColourToken, string>>;

function sequentialSteps(t: Tokens) {
  return [
    t['data-seq-1'],
    t['data-seq-2'],
    t['data-seq-3'],
    t['data-seq-4'],
    t['data-seq-5'],
  ] as const;
}

// Sequential magnitude, five steps, least first: heatmaps, intensity, density
// and the body diagram's weighted-set volume. Light runs light to dark, dark
// runs dark to light, so the most is always the step furthest from the page.
export const sequentialRamp = {
  light: sequentialSteps(colourTokens.light),
  dark: sequentialSteps(colourTokens.dark),
} as const;

function divergingSteps(t: Tokens) {
  return {
    cool: [t['data-div-cool-1'], t['data-div-cool-2'], t['data-div-cool-3']],
    mid: t['data-div-mid'],
    warm: [t['data-div-warm-1'], t['data-div-warm-2'], t['data-div-warm-3']],
  };
}

// Diverging around a baseline: three steps each side, nearest the midpoint
// first, with a grey midpoint for no change. Cool is below the baseline
// (faster, downhill, under target) and warm above it (slower, uphill, over).
export const divergingRamp = {
  light: divergingSteps(colourTokens.light),
  dark: divergingSteps(colourTokens.dark),
} as const;

// A section's two directions, cool forward against warm reverse so the pair
// survives colour blindness. A chart mark or a cue arrow takes one, always
// beside the direction's word or arrow.
export const directionPair = {
  light: {
    forward: colourTokens.light['direction-forward'],
    reverse: colourTokens.light['direction-reverse'],
  },
  dark: {
    forward: colourTokens.dark['direction-forward'],
    reverse: colourTokens.dark['direction-reverse'],
  },
} as const;

/** The sport families, named as the engine's family table names them. */
export type SportFamilyName = 'Ride' | 'Winter' | 'Run' | 'Water' | 'Foot' | 'Strength' | 'Other';

function sportFamilySteps(t: Tokens): Record<SportFamilyName, readonly [string, ...string[]]> {
  return {
    Ride: [t['sport-ride'], t['sport-ride-2'], t['sport-ride-3']],
    Winter: [t['sport-winter'], t['sport-winter-2'], t['sport-winter-3']],
    Run: [t['sport-run'], t['sport-run-2'], t['sport-run-3']],
    Water: [t['sport-water'], t['sport-water-2'], t['sport-water-3']],
    Foot: [t['sport-foot'], t['sport-foot-2'], t['sport-foot-3']],
    Strength: [t['sport-strength'], t['sport-strength-2'], t['sport-strength-3']],
    Other: [t['sport-other']],
  };
}

// Each sport family's colour, then its second and third fixed sub-shades, in
// the stack order the families are always drawn in. A mark, an edge or a line
// takes one; a label never sits on one, and Other is grey with no sub-shades.
export const sportFamilyColours = {
  light: sportFamilySteps(colourTokens.light),
  dark: sportFamilySteps(colourTokens.dark),
} as const;

// Strength's own data hue: worked muscles on the body diagram and the cards
// beside it. `primary` is a primary muscle and `secondary` an assisting one.
export const strengthTone = {
  primary: '#0D9488',
  secondary: '#2DD4BF',
  deep: '#0F766E',
} as const;

// Workout step intensity colors for WorkoutStepBar.
// warmup/tempo use amber (warning), threshold/VO2 use red (error),
// cooldown uses light blue, rest/recovery use gray.
export const workoutStepColors = {
  warmup: '#FFA726', // amber
  cooldown: '#64B5F6', // light blue
  rest: '#BDBDBD',
  tempo: '#FFA726', // amber
  threshold: '#EF4444', // red
} as const;

// =============================================================================
// SECTION OVERLAY PALETTE
// =============================================================================

// 8-color rotation for distinguishing overlapping section overlays on the map.
// Derived from a stable hash of the section ID so colors don't shuffle when
// the section list re-orders.
export const sectionPalette = [
  '#00BCD4',
  '#AB47BC',
  '#FF7043',
  '#66BB6A',
  '#42A5F5',
  '#FFCA28',
  '#26A69A',
  '#EC407A',
] as const;

// A separate warm/purple family so routes stay visually distinct from sections
// even when overlapping on the same map. Like sections, a route's colour is a
// hash of its id, so a regroup that reorders the routes leaves each its colour.
// The engine writes that hash on each route line as `palette`.
export const routePalette = [
  '#7C4DFF',
  '#AA00FF',
  '#D500F9',
  '#651FFF',
  '#6200EA',
  '#B388FF',
  '#EA80FC',
  '#CE93D8',
] as const;

function idHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function sectionPaletteIndex(sectionId: string): number {
  return idHash(sectionId) % sectionPalette.length;
}

// MapLibre expression builder: maps the `colorIndex` feature property to a
// palette colour. Uses `match` (not `literal` + `at`) because MapLibre only
// coerces hex strings to colours in direct positions - inside a literal array
// they stay typed as strings and trigger "Expected array<color>" errors.
export function sectionPaletteExpression(): unknown {
  const branches: unknown[] = [];
  sectionPalette.forEach((color, i) => {
    branches.push(i, color);
  });
  return ['match', ['get', 'colorIndex'], ...branches, sectionPalette[0]];
}

// The same for a route line: its `palette` property is the engine's hash of
// the route id, reduced here so the palette's length stays a theme fact.
export function routePaletteExpression(): unknown {
  const branches: unknown[] = [];
  routePalette.forEach((color, i) => {
    branches.push(i, color);
  });
  return ['match', ['%', ['get', 'palette'], routePalette.length], ...branches, routePalette[0]];
}

// =============================================================================
// MAP PREVIEW COLORS
// =============================================================================

// Background gradient and grid for the static route/section map previews
// (MiniTraceView, RouteRow, SectionRow SVGs) and the Skia feed preview halo.
// Deliberately muted greens.
export const mapPreviewColors = {
  routeHalo: '#FFFFFF', // White outline under the colored route line (theme-independent)
  light: {
    bg: '#e8f4e8',
    bgBottom: '#d4e8d4',
    grid: '#d0e8d0',
  },
  dark: {
    bg: '#1a2a1a',
    bgBottom: '#0d1a0d',
    grid: '#2a3a2a',
  },
} as const;

// =============================================================================
// MAP LAYER COLORS
// =============================================================================

// Colours for MapLibre layer paint, shared by every map surface. They are
// theme-independent on purpose: a route has to read against light, dark and
// satellite basemaps, so it carries its own contrast rather than following the
// app theme. Semi-transparent entries are rgba because MapLibre paint takes a
// colour string, not a colour plus a separate opacity.
export const mapLayerColors = {
  /** White casing drawn under every coloured line. */
  casing: '#FFFFFF',
  /** Start and end markers: a track's endpoints and the section creation handles. */
  startSolid: 'rgba(34,197,94,0.9)',
  endSolid: 'rgba(239,68,68,0.9)',
  /** The one selected trace among many. */
  highlight: '#00E5FF',
  /** A saved route drawn behind the activity that matched it. */
  routeOverlay: '#9C27B0',
  /** Personal record. Gold is reserved for achievements. */
  personalRecord: '#D4AF37',
  /** Section boundary ticks, drawn as a dark casing under white marks. */
  boundaryCasing: '#000000',
  /** Live section creation line. */
  sectionCreation: '#22C55E',
  /** Context track shown beyond a section while its bounds are being expanded. */
  extension: '#FF6B00',
  /** Time won against the reference on the section line, the diverging scale's one end. */
  deltaWon: '#2563eb',
  /** Time lost against the reference, the scale's other end. */
  deltaLost: '#f97316',
  /** Level with the reference, the scale's middle. */
  deltaNeutral: '#e5e7eb',
  /** A stretch the attempt did not cover. */
  deltaNoData: '#888888',
  /** The export privacy home and the radius trimmed around it. */
  homeRadius: brand.blue600,
  homeRadiusFill: 'rgba(47,102,153,0.18)',
} as const;

// =============================================================================
// LIGHT MODE COLORS
// =============================================================================

export const colors = {
  // The keys that read a role from the colour token file, per colourRoles.json.
  ...roleColours.light,

  // Activity type colors
  ride: '#3B82F6', // Blue-500 - Royal blue for cycling
  run: '#10B981', // Emerald-500 - Fresh green
  swim: '#06B6D4', // Cyan-500 - Aqua/teal
  // The three sport hues as text. The fitness screens set a threshold headline
  // in the sport's colour, where the hue is the information, and all three fills
  // sit between 2.18:1 and 3.31:1 on white. Worst light surface: ride 4.92:1,
  // run 4.93:1, swim 4.97:1.
  rideText: '#0B5FEA',
  runText: '#0A7854',
  swimText: '#047386',
  walk: '#8B5CF6', // Violet-500
  hike: '#A78BFA', // Violet-400
  workout: '#6366F1', // Indigo-500
  // Selected sport chip fills for the two hues that clear 4.5:1 under neither ink: white on these is 5.70 and 6.29.
  walkChipFill: '#7C3AED',
  workoutChipFill: '#4F46E5',

  // Chart accent colors
  chartBlue: brand.blue,
  chartPurple: '#A855F7',
  chartCyan: '#06B6D4',
  chartPink: '#EC4899',
  chartAmber: '#F59E0B',
  // Mark grade. The chart tones above are fills and lines, where the mark on
  // top carries the contrast. Where the mark itself is the carrier, the ring
  // round the best dot, the emerald fill `run` measures 2.28:1 on white, under
  // the 3:1 a graphical object owes. Same hue, lifted.
  chartGreenMark: '#15803D',
  // The rest of the series hues that reach a text style, same rule and same
  // method. Worst of the three light surfaces: chartPinkText 5.43:1,
  // chartPurpleText 6.28:1, fitnessBlueText 5.30:1, fatiguePurpleText 6.33:1.
  // The fills they darken are 3.17, 3.56, 2.66 and 4.33, and text has no
  // 1.4.11 exemption.
  chartPinkText: '#BE185D',
  chartPurpleText: '#7E22CE',
  fitnessBlueText: '#0F62C4',
  fatiguePurpleText: '#8E24AA',
  chartCasing: '#00000026', // Under-stroke behind chart lines for edge contrast

  // Wellness metric colors
  chartHrv: '#EC4899', // Pink-500
  chartRhr: '#EF4444', // Red-500
  // The two wellness hues as text, for the value and label beside a sparkline
  // drawn in them. Worst light surface: chartHrvText 5.43:1, chartRhrText 5.82:1.
  chartHrvText: '#BE185D',
  chartRhrText: '#B91C1C',
  chartSleep: '#A855F7', // Purple-500
  chartSleepScore: '#6366F1', // Indigo-500
  chartWeight: '#64748B', // Slate-500
  // The same amber as text: the estimated-FTP headline reads in it, and
  // `chartFtp` is 1.61:1 on white. 4.91:1 on the worst light surface.
  chartFtpText: '#8B6200',
  // The grey rule a curve chart draws its threshold on: FTP, critical speed and
  // critical swim speed each mark one, and none of them is a theme colour.
  chartGuideLine: '#969696',
  // The previous season's bars, drawn behind this season's. Cornflower rather
  // than the chart blue, so the two seasons are told apart by hue and not only
  // by opacity.
  chartPreviousSeason: '#4682DC',

  // Neutral chart overlays
  chartGridFaint: 'rgba(0, 0, 0, 0.06)', // Axis gridlines on an insight card
  chartZeroLine: 'rgba(0, 0, 0, 0.15)', // Baseline rule through zero
  chartMutedBar: 'rgba(0, 0, 0, 0.12)', // Comparison bar for the weaker period
  chartDotMuted: 'rgba(0, 0, 0, 0.25)', // Scatter dots that are not the record

  // Interval band backgrounds on the combined activity chart
  chartBandWarmup: '#22C55E', // Green-500
  chartBandCooldown: '#8B5CF6', // Violet-500
  chartBandNeutral: '#808080', // Grey - recovery, rest and anything unclassified

  // Form zone chart, drawn over opaque zone fills so these stay solid
  chartZeroLineSolid: '#CCCCCC',
  chartFormLine: '#333333',

  // Form zone text. The zone fills, which read the diverging ramp, are bands
  // and sparkline runs, grounds that 1.4.11 exempts at 3:1; a form number or a zone name drawn in one is text and
  // holds 4.5:1 on every light surface, which none of the fills reach.
  // `formOptimalText` also carries the efficiency headline and effort count,
  // which sit on an 18% tint of the fill, so it is the darkest of the five.
  // The five keep the fills' order, optimal darker than fresh.
  formTransitionText: '#1565C0',
  formFreshText: '#2E7D32',
  formGreyZoneText: '#616161',
  formOptimalText: '#1B5E20',
  formHighRiskText: '#C62828',

  // Mark-grade tones. The palette has three families: text at 4.5:1, a mark
  // at 3:1, a ground at no bar. These are the mark tones for hues whose fill
  // token sits under 3:1 on the light theme, so a border, a legend swatch or
  // a bar that is the only carrier of its meaning has one to take. Each holds
  // 3:1 against all three surfaces of both themes, which is why they are one
  // set rather than a light and a dark pair.
  markCyan: '#0891B2',
  markGreen: '#059669',
  markAmber: '#BE5A0A',
  markYellow: '#B87400',
  markOrange: '#CC6A00',
} as const;

// =============================================================================
// CHART STREAM COLORS
// =============================================================================

function streamSteps(t: Tokens) {
  return {
    power: t['stream-power'],
    heartrate: t['stream-heartrate'],
    cadence: t['stream-cadence'],
    // Speed and pace are one measurement, so they are one colour.
    speed: t['stream-speed'],
    pace: t['stream-speed'],
    gap: t['stream-gap'],
    wbal: t['stream-wbal'],
    // Elevation and temperature are context, grey rather than a hue. The line
    // carries the 3:1; an area under it takes `contextFill`.
    elevation: t['stream-context-line'],
    temp: t['stream-context-line'],
    contextFill: t['stream-context'],
    // Grade is signed: uphill on the warm arm of the diverging ramp, downhill
    // on the cool arm. Its key and line take the uphill step.
    grade: t['data-div-warm-2'],
    gradeUp: t['data-div-warm-2'],
    gradeDown: t['data-div-cool-2'],
    // Distance and time are axes rather than streams, drawn as context.
    distance: t['stream-context-line'],
    time: t['stream-context-line'],
  };
}

// One colour per activity data stream, per theme. The six identity streams,
// power, heart rate, cadence, speed, GAP and W'bal, are set apart from each
// other in that chip order, so any two of them can share a canvas.
export const chartStreamColors = {
  light: streamSteps(colourTokens.light),
  dark: streamSteps(colourTokens.dark),
} as const;

export type ChartStream = keyof (typeof chartStreamColors)['light'];

/** The colour a stream is drawn and keyed in, in the theme it is drawn on. */
export function chartStreamColour(stream: ChartStream, isDark: boolean): string {
  return chartStreamColors[isDark ? 'dark' : 'light'][stream];
}

// The ink a section's index number prints over its disc of section colour, one
// per palette slot. The disc carries the hue the map draws the section in, and
// the hue does not change with the theme, so neither does the ink: light
// (white) where it clears 4.5:1, dark where white does not.
export const sectionPaletteInk: readonly ('light' | 'dark')[] = [
  'dark',
  'light',
  'dark',
  'dark',
  'dark',
  'dark',
  'dark',
  'dark',
];

/** The ink colour a section's index number takes on its palette slot. */
export function sectionNumberInk(slot: number): string {
  return sectionPaletteInk[slot] === 'light' ? colors.textOnFill : colors.textOnBright;
}

// A list row's swipe actions: each fill with the ink its label and icon take.
// The action sits behind the row in both themes, so the pair does not change
// with the theme. White on the error red is 3.76:1, so the destructive action
// takes the deep red; the amber and green keep their hue and take dark ink.
export const swipeAction = {
  destructive: { bg: colors.dangerFill, text: colors.textOnFill },
  hide: { bg: colors.warningFill, text: colors.textOnBright },
  restore: { bg: colors.successFill, text: colors.textOnBright },
} as const;

// Static thumbnails for the map style picker. Each is the style's own land,
// water and road tint, so a viewer recognises the style without the app having
// to run three live maps to draw three 70px circles. The light and dark ones are
// the base's own ground tokens, which the basemap itself paints with.
const baseGround = (base: 'light' | 'dark') => {
  const tokens = colourTokens.light as Record<string, string>;
  return {
    land: tokens[`map-${base}-land`],
    water: tokens[`map-${base}-water`],
    road: tokens[`map-${base}-road`],
  };
};

export const mapStylePreview = {
  light: baseGround('light'),
  dark: baseGround('dark'),
  satellite: { land: '#2F5E3A', water: '#1B4A63', road: '#C9BFA5' },
} as const;

// Verdict ladder: the one palette a good, caution or bad judgement is drawn
// from. Each rung is text or an icon, so every token clears 4.5:1 against every
// surface of its own theme, not only against white and #18181B: a verdict is
// drawn on cards, and a card is `backgroundAlt` in light and `surfaceCard` in
// dark, both further from the text tone than those two. The three polarity
// rungs run monotone in luminance and hold at least 1.4:1 between adjacent
// steps, measured 1.41:1 light and 1.53:1 dark. That is consistency, not
// greyscale readability: no five colours inside the readable band reach the
// 3:1 a verdict would need to be legible without hue. Neutral is grey so it
// can never read as a polarity, and record is gold and off the chain. The
// record light tone darkens brand.goldDark, which is only 2.87:1 on white.
export const verdict = {
  negative: { light: '#7F1D1D', dark: '#F25C5C' },
  caution: { light: '#92400E', dark: '#F59E0B' },
  positive: { light: '#15803D', dark: '#86EFAC' },
  neutral: { light: '#52525B', dark: '#A1A1AA' },
  record: { light: '#806A22', dark: brand.goldLight },
} as const;

export type VerdictRung = keyof typeof verdict;

export function verdictColor(rung: VerdictRung, isDark: boolean): string {
  return isDark ? verdict[rung].dark : verdict[rung].light;
}

// A chip wants a translucent fill behind the rung's text, which the ladder has
// no tone for. Rather than a second set of hues, which is the split this
// replaces, the fill is the rung itself at two alpha steps: 0x18 for a chip
// and 0x26 for the denser progression card. The text on it stays `verdictColor`, so a chip is one hue at two
// weights and the ladder still decides which hue.
export function verdictFill(rung: VerdictRung, isDark: boolean, strong = false): string {
  return `${verdictColor(rung, isDark)}${strong ? '26' : '18'}`;
}

// What an insight's icon is drawn from. A polarity is a ladder rung; `info`
// and `opportunity` are not judgements, so the ladder has no rung for them and
// they take the link and warning text roles.
export type InsightTone = VerdictRung | 'info' | 'opportunity';

export function insightToneColor(tone: InsightTone, isDark: boolean): string {
  if (tone === 'info') return (isDark ? roleColours.dark : roleColours.light).actionLink;
  if (tone === 'opportunity') return (isDark ? roleColours.dark : roleColours.light).warningText;
  return verdictColor(tone, isDark);
}

// The style guide's `record` role, on every recording surface: the record
// button, the live dot, the widgets, the Live Activity and the notifications.
// Blue stays the action colour, so record is never action-primary. The export
// keeps the name `recording` because `record` is already the insight tone for a
// personal record, in gold. Both tones carry the white glyph at AA text, light
// 6.22:1 and dark 4.93:1, and hold the graphical-object bar on every surface of
// their own theme, the worst light 5.60:1 and the worst dark 3.17:1. Dark is the
// lighter tone, the same way round as every other pair here.
export const recording = {
  light: '#C1121F',
  dark: '#D1352F',
} as const;

// The activity heatmap's five levels: no activity on the neutral fill, then
// the first four steps of the sequential ramp.
export const contributionRamp = {
  light: [colourTokens.light['fill-neutral'], ...sequentialRamp.light.slice(0, 4)],
  dark: [colourTokens.dark['fill-neutral'], ...sequentialRamp.dark.slice(0, 4)],
} as const;

// The crash screen paints itself before any theme provider is mounted, so it
// carries its own chrome, one set per mode, chosen from the system appearance.
export const errorScreen = {
  light: {
    bg: '#FAFAFA',
    title: '#18181B',
    detail: '#52525B',
    message: '#B91C1C',
    action: brand.blue600,
  },
  dark: {
    bg: '#1A1A1A',
    title: '#FFFFFF',
    detail: '#999999',
    message: '#FF6B6B',
    action: brand.blueLight,
  },
} as const;

// Muscle body diagram: the base fill under the volume ramp, the neutral fill of
// each mode, and the outline on the selected group, one per mode. The outline
// runs along the polygon boundaries, which are the page showing through rather
// than the fill, so a near-black stroke that reads at 17:1 on the light page is
// drawn in the colour of the dark one.
export const bodyDiagram = {
  fillLight: colourTokens.light['fill-neutral'],
  fillDark: colourTokens.dark['fill-neutral'],
  selectedStroke: '#1A1A1A',
  selectedStrokeDark: '#FAFAFA',
} as const;

// The one-frame Skia warmup surface. Primaries on purpose: it compiles the
// shaders and is never seen.
export const shaderWarmup = {
  area: '#FF0000',
  line: '#888888',
  rect: '#333333',
  shadow: '#000000',
} as const;

// The QR scanner covers the screen with the camera feed, so its chrome is
// fixed against the preview rather than following the theme.
export const cameraOverlay = {
  bg: '#000000',
  text: '#FFFFFF',
  hint: '#999999',
} as const;

// Loupe magnifier chrome (strength body diagram). The clip background follows
// the theme; the crosshair dot/ring stay fixed for contrast on body fills.
export const loupeChrome = {
  bgLight: '#F0F0F0',
  bgDark: '#18181B',
  crosshairDot: '#1A1A1A',
  crosshairRing: '#FFFFFF',
} as const;

// =============================================================================
// DARK MODE COLORS (Whoop-inspired)
// =============================================================================

export const darkColors = {
  // The keys that read a role from the colour token file, per colourRoles.json.
  ...roleColours.dark,

  // Mark grade, the dark half of the pair in `colors`. A near-black surface
  // wants the light tone where white wants the deep one, so a mark that reads
  // one token in both themes is the same defect the other way round.
  chartGreenMark: '#86EFAC',

  // Secondary - Blue (charts, data)
  secondary: brand.blue, // Full blue for dark mode

  // Chart colors for dark mode (optimised for visibility)
  chartPurple: '#C084FC', // Custom tag ground
  chartForm: brand.blueLight, // Brighter blue for TSB (neutral, zone-based at runtime)
  chartCasing: '#00000080', // Under-stroke behind chart lines for edge contrast

  // Wellness metric colors for dark mode (one Tailwind step lighter)
  chartHrv: '#F472B6', // Pink-400
  chartRhr: '#F87171', // Red-400
  // On the dark surfaces both fills already clear 4.5:1, 5.91:1 and 5.65:1 on
  // the worst, so the text tone is the fill.
  chartHrvText: '#F472B6',
  chartRhrText: '#F87171',
  chartSleep: '#C084FC', // Purple-400
  chartSleepScore: '#818CF8', // Indigo-400
  chartWeight: '#94A3B8', // Slate-400
  chartGuideLine: '#969696',
  chartPreviousSeason: '#6495ED', // Lighter cornflower, to carry on a dark ground

  // Neutral chart overlays for dark mode
  chartGridFaint: 'rgba(255, 255, 255, 0.06)',
  chartZeroLine: 'rgba(255, 255, 255, 0.25)',
  chartMutedBar: 'rgba(255, 255, 255, 0.15)',
  chartDotMuted: 'rgba(255, 255, 255, 0.5)',
  chartZeroLineSolid: '#71717A',
  chartFormLine: '#FFFFFF',

  // Text variants of the series hues, the dark counterparts of the light ones.
  // On a near-black ground the fill itself already clears 4.5:1 for four
  // of the six, so the token is the fill and the pair still exists: a caller
  // reads one name in both themes. Worst of the three dark surfaces:
  // chartGoldText 7.44:1, chartFtpText 8.71:1, formOptimalText 6.62:1,
  // runText 6.17:1, swimText 6.44:1. Only `ride` needs its own tone, at 4.25:1.
  chartFtpText: '#FFB300',
  // The B950 half of the pair. On the dark surfaces the fitness blue already
  // carries at 5.91:1 and is its own text tone; pink, purple and the fatigue
  // purple do not (4.43, 3.95 and 3.25) and take a lighter step, 5.91:1,
  // 5.92:1 and 6.55:1 on the worst of the three.
  chartPinkText: '#F472B6',
  chartPurpleText: '#C084FC',
  fitnessBlueText: '#42A5F5',
  fatiguePurpleText: '#CE93D8',
  rideText: '#4F8FF7',
  runText: '#10B981',
  swimText: '#06B6D4',
  // The rest of the form zone text family. Same story: four of the five
  // are the fill, and the red is the one that does not carry, 4.49:1 on the
  // raised surface, so it takes the lighter tone the dark palette uses for error.
  formTransitionText: '#64B5F6',
  formFreshText: '#81C784',
  formGreyZoneText: '#9E9E9E',
  formOptimalText: '#66BB6A',
  formHighRiskText: '#F87171',
} as const;

// =============================================================================
// OPACITY SCALE
// =============================================================================

// The one alpha ladder. A tint, a state and a press each read a step, and no
// other alpha is drawn. The four tints wash a colour over a ground, faintest
// first.
export const opacity = {
  tint1: 0.06,
  tint2: 0.12,
  tint3: 0.18,
  tint4: 0.3,
  // A chip or row that is out of play but still part of the layout, drawn fainter than disabled,
  // and a held render while its data refetches.
  dim: 0.4,
  // A control that refuses the press, drawn at this opacity on top of reporting itself disabled.
  disabled: 0.5,
  // How far a press fades on iOS. Android draws the ripple instead.
  pressed: 0.7,
  // Light mode overlays (black with opacity)
  overlay: {
    subtle: 'rgba(0, 0, 0, 0.03)',
    light: 'rgba(0, 0, 0, 0.05)',
    medium: 'rgba(0, 0, 0, 0.1)',
    scrim: 'rgba(0, 0, 0, 0.4)',
    heavy: 'rgba(0, 0, 0, 0.5)',
    full: 'rgba(0, 0, 0, 0.65)',
  },
  // Dark mode overlays (white with opacity)
  overlayDark: {
    subtle: 'rgba(255, 255, 255, 0.03)',
    light: 'rgba(255, 255, 255, 0.05)',
    medium: 'rgba(255, 255, 255, 0.1)',
    heavy: 'rgba(255, 255, 255, 0.15)',
  },
} as const;

// =============================================================================
// ACTIVITY TYPE COLOR MAP
// =============================================================================

export const activityTypeColors: Record<string, string> = {
  Ride: '#3B82F6', // Blue-500
  VirtualRide: '#3B82F6',
  MountainBikeRide: '#2563EB', // Blue-600
  GravelRide: '#1D4ED8', // Blue-700
  EBikeRide: '#60A5FA', // Blue-400

  Run: '#10B981', // Emerald-500
  VirtualRun: '#10B981',
  TrailRun: '#059669', // Emerald-600

  Swim: '#06B6D4', // Cyan-500
  OpenWaterSwim: '#0891B2', // Cyan-600

  Walk: '#8B5CF6', // Violet-500
  Hike: '#A78BFA', // Violet-400

  Workout: '#6366F1', // Indigo-500
  WeightTraining: '#4F46E5', // Indigo-600

  Yoga: '#EC4899', // Pink-500
  Rowing: '#14B8A6', // Teal-500
  Kayaking: '#14B8A6',
  Canoeing: '#14B8A6',

  Tennis: '#C2410C', // Orange-700 - the racket family, 5.18:1 on white
  Badminton: '#C2410C',
  Pickleball: '#C2410C',
  Racquetball: '#C2410C',
  Squash: '#C2410C',
  TableTennis: '#C2410C',

  Snowboard: '#38BDF8', // Sky-400
  AlpineSki: '#0EA5E9', // Sky-500
  NordicSki: '#0284C7', // Sky-600
  BackcountrySki: '#0EA5E9',

  Other: '#71717A', // Zinc-500
};

// The sport hue as an icon drawn straight on a surface, a mark that owes 3:1
// on every surface of its theme. The hue is kept where it already clears that,
// and a type that does not takes the next tone of its own family: deeper on
// the light surfaces, lighter on the dark ones. The fills, map tracks and
// widget tints keep `activityTypeColors`, since they sit on other grounds.
// Worst light surface: Run, Hike and the water sports 3.37:1 or more, the
// rest 3.31:1 or more. Worst dark surface: MountainBikeRide 3.03:1, the
// racket family 3.02:1, GravelRide 4.25:1, WeightTraining 3.50:1.
export const activityTypeInk: Record<string, string> = {
  ...activityTypeColors,
  EBikeRide: '#3B82F6', // Blue-500
  Run: '#059669', // Emerald-600
  VirtualRun: '#059669',
  Swim: '#0891B2', // Cyan-600
  Hike: '#8B5CF6', // Violet-500
  Rowing: '#0D9488', // Teal-600
  Kayaking: '#0D9488',
  Canoeing: '#0D9488',
  Snowboard: '#0284C7', // Sky-600
  AlpineSki: '#0284C7',
  BackcountrySki: '#0284C7',
};

export const activityTypeInkDark: Record<string, string> = {
  ...activityTypeColors,
  GravelRide: '#3B82F6', // Blue-500
  WeightTraining: '#6366F1', // Indigo-500
};

// =============================================================================
// TRAINING ZONE COLORS
// =============================================================================

export const zoneColors = {
  zone1: '#009E80', // Teal - Recovery (intervals.icu)
  zone2: '#009E00', // Green - Endurance (intervals.icu)
  zone3: '#FFCB0E', // Yellow - Tempo (intervals.icu)
  zone4: '#FF7F0E', // Orange - Threshold (intervals.icu)
  zone5: '#DD0447', // Red-pink - VO2max (intervals.icu)
  zone6: '#6633CC', // Purple - Anaerobic (intervals.icu)
  zone7: '#1A1A1A', // Near-black - Neuromuscular (intervals.icu)
} as const;

/**
 * The zone ladder as a fill on a dark ground, held to 3:1 on every dark
 * surface. Zones 1 to 5 keep the intervals.icu fill. The anaerobic purple at
 * 2.17:1 on the dark card is lifted in the same hue, and the near-black zone 7
 * at 1.02:1 becomes a light grey.
 */
export const zoneColorsDark = {
  ...zoneColors,
  zone6: '#8A5CE6',
  zone7: '#B0B0B0',
} as const;

/**
 * The zone ladder as a fill on a light ground, held to 3:1 on every light
 * surface. The tempo yellow at 1.37:1 and the threshold orange at 2.28:1 on the
 * alternate background are darkened in the same hue; the other zones already
 * clear it and keep the intervals.icu fill.
 */
export const zoneColorsLight = {
  ...zoneColors,
  zone3: '#AB8809',
  zone4: '#DB6D0C',
} as const;

/**
 * Each zone fill darkened to 4.5:1 for text on its own 18% tint over the light
 * screen ground. Zones 6 and 7 already clear it and keep their fill.
 */
export const zoneTextColors = {
  zone1: '#006F5A',
  zone2: '#006F00',
  zone3: '#806607',
  zone4: '#994C08',
  zone5: '#BA033B',
  zone6: '#6633CC',
  zone7: '#1A1A1A',
} as const;

/**
 * Each zone fill lifted to 4.5:1 for text on its 18% tint over the dark screen
 * ground, and on every dark surface: zone 7 takes the light grey of its dark
 * fill, which the mid grey at 4.02:1 on the dark card did not clear.
 */
export const zoneTextColorsDark = {
  zone1: '#26AD93',
  zone2: '#26AD26',
  zone3: '#FFCB0E',
  zone4: '#FF7F0E',
  zone5: '#E95C87',
  zone6: '#9C7ADE',
  zone7: '#B0B0B0',
} as const;
