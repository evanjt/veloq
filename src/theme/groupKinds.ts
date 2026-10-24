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
 *   measurable without knowing the screen: the QR scanner's text on its
 *   camera chrome. A translucent fill is composited over the theme surface
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
      'blue600',
      'blue550',
      'blue700',
      'gold',
      'goldLight',
      'goldDark',
      'blue',
      'blueLight',
      'blueDark',
    ],
  },
  nativeColours: {
    kind: 'series',
    reason:
      'colours native code posts under, such as the notification light, which no screen draws on a surface',
    series: ['notificationAccent'],
  },
  sequentialRamp: {
    kind: 'series',
    reason:
      'five magnitude steps per mode, the body diagram volume and the heatmaps, read against the step beside it with a legend',
  },
  divergingRamp: {
    kind: 'series',
    reason:
      'three steps each side of a grey midpoint per mode, read against the baseline and labelled by the axis or the legend',
  },
  sportFamilyColours: {
    kind: 'series',
    reason:
      'one colour per sport family and two fixed sub-shades, drawn as a mark beside the sport name, never as its ground',
  },
  sectionPalette: {
    kind: 'series',
    reason: "the map line colours, told apart from each other and from the base's edge under them",
  },
  routePalette: {
    kind: 'series',
    reason:
      "the route line colours, told apart from each other and from the base's edge under them",
  },
  mapLayerColors: {
    kind: 'series',
    reason:
      'lines on map tiles, each over its own white casing, which is outside the surface rule: the ground is the basemap',
  },
  chartStreamColors: {
    kind: 'series',
    reason:
      'one hue per stream and mode, with a labelled chip and a labelled axis; speed and pace share one, elevation and temperature are grey context',
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
  mapStylePreview: {
    kind: 'series',
    reason: 'each style thumbnail is its own land, water and road, recognised as a picture',
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
  directionPair: {
    kind: 'mark',
    reason:
      'the forward and reverse colours of a section chart, each a dot, a line or an arrow beside its direction word, so each theme answers to 3:1 on its surfaces',
    marks: [
      { paths: ['light.forward', 'light.reverse'], theme: 'light' },
      { paths: ['dark.forward', 'dark.reverse'], theme: 'dark' },
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
  contributionRamp: {
    kind: 'series',
    reason: 'five activity steps per mode, read as a ramp against the step beside it',
  },
  bodyDiagram: {
    kind: 'mark',
    reason:
      "the untrained outline and the selected outline run along the polygon boundaries, which are the page showing through, so each is read against its mode's surfaces. The untrained fill sits under the outline and the steps are the sequential ramp, told apart by the legend",
    marks: [
      { paths: ['light.untrainedStroke', 'light.selectedStroke'], theme: 'light' },
      { paths: ['dark.untrainedStroke', 'dark.selectedStroke'], theme: 'dark' },
    ],
  },
  shaderWarmup: {
    kind: 'series',
    reason:
      'drawn once off screen to compile the shaders, never seen. Primary red on purpose, so a frame that does reach the screen is obvious',
  },
  loupeChrome: {
    kind: 'mark',
    reason:
      "the crosshair over the loupe's clip, which is each mode's raised surface: the dot reads on the light one, the ring on the dark one",
    marks: [
      { paths: ['crosshairDot'], theme: 'light' },
      { paths: ['crosshairRing'], theme: 'dark' },
    ],
  },
  opacity: {
    kind: 'series',
    reason: 'alpha steps, not colours',
  },
  activityTypeColors: {
    kind: 'series',
    reason: 'one hue per activity type, every site labelling or icon-ing it as well',
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
