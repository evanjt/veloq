/**
 * Which bar each surface-specific colour group in `colors.ts` answers to.
 *
 * `tokenFamilies.ts` covers `colors` and `darkColors`, the two palettes read
 * everywhere. It scoped itself to those deliberately, and `colors.ts` exports
 * two dozen more groups that it does not, so a badge label tone added at 2:1
 * on its own fill passed every gate. This is the same rule for those groups.
 *
 * The groups are not palettes of interchangeable tokens, so a family per token
 * does not fit them. Each is one of three kinds:
 *
 * - `pair` states a foreground and its own ground together, so the pair is
 *   measurable without knowing the screen: the offline pill's text on the
 *   pill's fill. A translucent fill is composited over the theme surface
 *   first, which is where the alpha of an eight-digit hex fill matters.
 * - `mark` is drawn on whatever surface the theme gives it, so it answers to
 *   3:1 against the three surfaces of its theme, the same as a mark token.
 * - `series` is told apart from the others in its own group rather than read
 *   against a surface: the section palette, the activity-type hues, the zone
 *   ladder. 1.4.11 asks that the information be available another way, and for
 *   every one of these it is a label or a legend, so the bar here is that the
 *   members are distinct rather than that any of them clears a ratio.
 *
 * `groupContrast.test.ts` reads this, measures the pairs and the marks, checks
 * the series for duplicates, and fails on a group `colors.ts` exports that has
 * no line here. So a group added tomorrow has to be classified before it lands.
 */

import { activityTypeInk, activityTypeInkDark, insightCategoryColors } from './colors';

/** What kind of thing a group holds, and therefore how it is measured. */
export type GroupKind = 'pair' | 'mark' | 'series';

/**
 * One foreground on one ground, both named so the test can find them. `on` is a
 * path into the group, dot-separated, and `ground` is either a path in the same
 * group or the literal `surface`, meaning the theme's own surfaces.
 */
export interface PairSpec {
  ground: string;
  on: string[];
  /** The bar the foregrounds answer to. Text is 4.5:1, a mark on a fill 3:1. */
  bar: 'text' | 'mark';
}

export interface GroupSpec {
  kind: GroupKind;
  /** Why it is that kind, in one line. */
  reason: string;
  /** For `pair`: every foreground-on-ground the group states. */
  pairs?: PairSpec[];
  /** For `mark`: the paths drawn on the theme surface, and which theme. */
  marks?: { paths: string[]; theme: 'light' | 'dark' | 'both' }[];
  /** For `series`: the paths whose values must stay distinct from each other. */
  series?: string[];
}

export const GROUP_KINDS: Record<string, GroupSpec> = {
  ink: {
    kind: 'series',
    reason: 'black and white, the two ends every other tone is mixed against',
    series: ['white', 'black'],
  },
  brand: {
    kind: 'series',
    reason:
      'the signature hues and their light and dark steps. Read through colors and darkColors, which tokenFamilies covers, never drawn straight',
    series: [
      'teal',
      'tealLight',
      'tealDark',
      'gold',
      'goldLight',
      'goldDark',
      'blue',
      'blueLight',
      'blueDark',
    ],
  },
  rpeRamp: {
    kind: 'series',
    reason: 'a six-step effort ramp, read against its neighbours and labelled with the number',
  },
  strengthRamp: {
    kind: 'series',
    reason: 'a five-step volume ramp on the body diagram, with a legend',
  },
  workoutStepColors: {
    kind: 'series',
    reason: 'one hue per workout step, each with its name beside it',
  },
  sectionPalette: {
    kind: 'series',
    reason: 'the map line colours, told apart from each other and from the white casing under them',
  },
  routePalette: {
    kind: 'series',
    reason:
      'the route line colours, told apart from each other and from the white casing under them',
  },
  mapPreviewColors: {
    kind: 'series',
    reason:
      'a generated tile. The halo is a casing whose job is to separate the coloured line from whatever is under it, so it is measured against the line and not against the ground: white on the pale green preview bed is 1.13:1 and that is the casing working, not failing',
  },
  mapLayerColors: {
    kind: 'series',
    reason:
      'lines on map tiles, each over its own white casing, which is outside the surface rule: the ground is the basemap',
  },
  gradientScale: {
    kind: 'series',
    reason:
      'the activity line coloured by gradient, over its white casing on the basemap, keyed by a labelled ramp while it draws',
  },
  chartStreamColors: {
    kind: 'series',
    reason: 'one hue per stream, with a labelled chip and a labelled axis',
  },
  chartStreamInk: {
    kind: 'series',
    reason:
      'the label ink of a selected chart chip, one per stream hue. Measured against its hue at 4.5:1 in chartStreamInk.test.ts, because the ground is in another group',
  },
  sectionPaletteInk: {
    kind: 'series',
    reason:
      "the ink of a section's index number, one per palette slot. Measured against its slot's hue at 4.5:1 in sectionInlinePlot.test.tsx, because the ground is in another group",
  },
  swipeAction: {
    kind: 'pair',
    reason: "a list row's swipe action fill with the ink of its label and icon",
    pairs: [
      { ground: 'destructive.bg', on: ['destructive.text'], bar: 'text' },
      { ground: 'hide.bg', on: ['hide.text'], bar: 'text' },
      { ground: 'restore.bg', on: ['restore.text'], bar: 'text' },
    ],
  },
  mapStyleSwatch: {
    kind: 'pair',
    reason: 'the picker chip: its icon sits on the swatch, which is the ground',
    pairs: [
      { ground: 'light', on: ['..mapStyleSwatchIcon.light'], bar: 'mark' },
      { ground: 'dark', on: ['..mapStyleSwatchIcon.dark'], bar: 'mark' },
      { ground: 'satellite', on: ['..mapStyleSwatchIcon.dark'], bar: 'mark' },
    ],
  },
  mapStylePreview: {
    kind: 'series',
    reason: 'each style thumbnail is its own land, water and road, recognised as a picture',
  },
  mapStyleSwatchIcon: {
    kind: 'pair',
    reason: 'measured as the foreground of mapStyleSwatch, which names the ground',
    pairs: [],
  },
  insightIcon: {
    kind: 'mark',
    reason:
      "the two category tones of an insight. In the app the icon sits on a tint of itself beside the insight's title, but a widget row's dot is the only mark of its tone, so each theme's tone answers to 3:1 on that theme's surfaces. Read only through insightToneColor",
    marks: [
      { paths: ['info.light', 'opportunity.light'], theme: 'light' },
      { paths: ['info.dark', 'opportunity.dark'], theme: 'dark' },
    ],
  },
  verdict: {
    kind: 'pair',
    reason:
      'the judgement ladder, each rung text on the theme surface. verdictLadder.test.ts holds the steps between rungs as well',
    pairs: [
      {
        ground: 'surface',
        on: ['negative.light', 'caution.light', 'positive.light', 'neutral.light', 'record.light'],
        bar: 'text',
      },
      {
        ground: 'surface',
        on: ['negative.dark', 'caution.dark', 'positive.dark', 'neutral.dark', 'record.dark'],
        bar: 'text',
      },
    ],
  },
  recording: {
    kind: 'mark',
    reason: 'the recording dot, the only thing that says a ride is being recorded',
    marks: [
      { paths: ['light'], theme: 'light' },
      { paths: ['dark'], theme: 'dark' },
    ],
  },
  offlinePill: {
    kind: 'pair',
    reason: 'the offline pill floats over either scheme, so it carries its own fill and ink',
    pairs: [{ ground: 'bg', on: ['text'], bar: 'text' }],
  },
  contributionRamp: {
    kind: 'series',
    reason: 'five activity steps per mode, read as a ramp against the step beside it',
  },
  errorScreen: {
    kind: 'pair',
    reason:
      'the crash screen paints before any theme is mounted, so it carries its own ground, per mode',
    pairs: [
      { ground: 'light.bg', on: ['light.title', 'light.detail', 'light.message'], bar: 'text' },
      { ground: 'light.bg', on: ['light.action'], bar: 'text' },
      { ground: 'dark.bg', on: ['dark.title', 'dark.detail', 'dark.message'], bar: 'text' },
      { ground: 'dark.bg', on: ['dark.action'], bar: 'text' },
    ],
  },
  bodyDiagram: {
    kind: 'mark',
    reason:
      "the stroke outlining a selected group runs along the polygon boundaries, which are the page showing through and not the fill it encloses, so each mode's stroke is read against that mode's surfaces. The two fills are the ramp's base and are told apart by the ramp above them",
    marks: [
      { paths: ['selectedStroke'], theme: 'light' },
      { paths: ['selectedStrokeDark'], theme: 'dark' },
    ],
  },
  shaderWarmup: {
    kind: 'series',
    reason:
      'drawn once off screen to compile the shaders, never seen. Primary red on purpose, so a frame that does reach the screen is obvious',
  },
  switchTrackOff: {
    kind: 'mark',
    reason:
      "the off track is the boundary that shows an off switch is there at all, so it is a mark at 3:1 against each mode's surfaces, the same bar as the on state's tint",
    marks: [
      { paths: ['light'], theme: 'light' },
      { paths: ['dark'], theme: 'dark' },
    ],
  },
  inputBoundary: {
    kind: 'mark',
    reason:
      'the outline of a text field, the one thing that says where to type, drawn on the theme surface',
    marks: [
      { paths: ['light'], theme: 'light' },
      { paths: ['dark'], theme: 'dark' },
    ],
  },
  cameraOverlay: {
    kind: 'pair',
    reason: 'the QR scanner chrome over the camera feed, fixed rather than themed',
    pairs: [{ ground: 'bg', on: ['text', 'hint'], bar: 'text' }],
  },
  loupeChrome: {
    kind: 'pair',
    reason: 'the magnifier: the crosshair over the clip background, per mode',
    pairs: [
      { ground: 'bgLight', on: ['crosshairDot'], bar: 'mark' },
      { ground: 'bgDark', on: ['crosshairRing'], bar: 'mark' },
    ],
  },
  gradients: {
    kind: 'series',
    reason:
      'two-stop fills. A gradient is a ground, and what sits on it is a token tokenFamilies covers',
  },
  glows: {
    kind: 'series',
    reason: 'translucent shadow colours, which draw no information at all',
  },
  opacity: {
    kind: 'series',
    reason: 'alpha steps, not colours',
  },
  activityTypeColors: {
    kind: 'series',
    reason: 'one hue per activity type, every site labelling or icon-ing it as well',
  },
  activityTypeInk: {
    kind: 'mark',
    reason: 'the activity-type hue as an icon on a light surface, held to 3:1',
    marks: [{ paths: Object.keys(activityTypeInk), theme: 'light' }],
  },
  activityTypeInkDark: {
    kind: 'mark',
    reason: 'the activity-type hue as an icon on a dark surface, held to 3:1',
    marks: [{ paths: Object.keys(activityTypeInkDark), theme: 'dark' }],
  },
  zoneColors: {
    kind: 'series',
    reason: "intervals.icu's own zone ladder, with the zone number beside every use",
  },
  zoneColorsDark: {
    kind: 'mark',
    reason: 'the zone ladder as a bar, dot or skyline step on a dark ground, held to 3:1',
    marks: [
      { paths: ['zone1', 'zone2', 'zone3', 'zone4', 'zone5', 'zone6', 'zone7'], theme: 'dark' },
    ],
  },
  zoneColorsLight: {
    kind: 'mark',
    reason: 'the zone ladder as a bar, dot or skyline step on a light ground, held to 3:1',
    marks: [
      { paths: ['zone1', 'zone2', 'zone3', 'zone4', 'zone5', 'zone6', 'zone7'], theme: 'light' },
    ],
  },
  zoneTextColors: {
    kind: 'mark',
    reason:
      'the zone ladder as text on the light zone tint, held to 4.5:1 by zoneTextOnTint.test.ts',
    marks: [
      { paths: ['zone1', 'zone2', 'zone3', 'zone4', 'zone5', 'zone6', 'zone7'], theme: 'light' },
    ],
  },
  zoneTextColorsDark: {
    kind: 'mark',
    reason:
      'the zone ladder as text on the dark zone tint and every dark surface, held to 4.5:1 by zoneTextOnTint.test.ts and zoneColour.test.ts',
    marks: [
      { paths: ['zone1', 'zone2', 'zone3', 'zone4', 'zone5', 'zone6', 'zone7'], theme: 'dark' },
    ],
  },
  insightCategoryColors: {
    kind: 'mark',
    reason: 'one hue per insight category, drawn as the history graphic and the card edge',
    marks: (['light', 'dark'] as const).map((theme) => ({
      paths: Object.keys(insightCategoryColors).map((category) => `${category}.${theme}`),
      theme,
    })),
  },
  verdictFill: {
    kind: 'series',
    reason:
      'the verdict rung at two alpha steps, a ground for the rung text verdict already measures',
  },
};

/**
 * Pairs and marks that are under their bar today, with the ratio and the item
 * that owns the repair. The same shape as `UNDER_BAR` in `tokenFamilies.ts`: an
 * entry here is a recorded failure, not an exemption, and the list only shortens.
 *
 * The key is `group:path`. The colon rather than a dot is load-bearing: the
 * verdict-palette guard reads a badge rung spelled with a dot as a polarity being
 * drawn from a palette that is not the ladder, and a record of a failure is not a
 * draw. Spell it with a dot anywhere in this file, comments included, and the
 * audit gate fails.
 */
export const GROUP_UNDER_BAR: Record<string, string> = {};
