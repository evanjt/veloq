/**
 * Veloq Premium Color Palette
 *
 * Primary: Teal (mode-aware) - everyday interactions
 * Accent: Gold - achievements, celebrations, PRs only
 * Secondary: Blue - charts, data visualization
 *
 * Aesthetic: Premium/Luxury, Whoop-inspired, Dark-mode-first
 */

/**
 * Creates a color with opacity from a hex color
 * @param hex - The hex color (e.g., '#D4AF37' or 'D4AF37')
 * @param opacity - The opacity value (0-1)
 * @returns rgba string
 */
export function colorWithOpacity(hex: string, opacity: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
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

export const brand = {
  // Teal - Primary (buttons, links, CTAs)
  // Mode-aware: use teal.light for light mode, teal.dark for dark mode
  teal: '#14B8A6', // Teal-500 - base
  tealLight: '#0D9488', // Teal-600 - for light mode (darker for contrast on white)
  tealDark: '#2DD4BF', // Teal-400 - for dark mode (lighter for contrast on dark)
  tealHover: '#0F766E', // Teal-700 - light mode hover
  tealHoverDark: '#14B8A6', // Teal-500 - dark mode hover

  // Gold - Accent (achievements, PRs, celebrations ONLY)
  gold: '#D4AF37',
  goldLight: '#E8C96E',
  goldDark: '#B8942F',

  // Blue - Secondary (charts, data visualization)
  blue: '#5B9BD5',
  blueLight: '#7DB3E3',
  blueDark: '#3A7AB8',
} as const;

// Strength volume heatmap: 5-step teal ramp (light to saturated).
// Used by the muscle body diagram to encode weighted-set volume per muscle.
// Effort ramp for the RPE slider (easy to maximal, 1-10 mapped in pairs).
export const rpeRamp = [
  '#22C55E', // green, RPE 1-2
  '#84CC16', // lime, RPE 3-4
  '#EAB308', // yellow, RPE 5-6
  '#F97316', // orange, RPE 7-8
  '#EF4444', // red, RPE 9-10
] as const;

export const strengthRamp = [
  '#CCFBF1', // Teal-100
  '#99F6E4', // Teal-200
  '#5EEAD4', // Teal-300
  '#2DD4BF', // Teal-400
  '#0D9488', // Teal-600
] as const;

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

export function sectionPaletteIndex(sectionId: string): number {
  let hash = 0;
  for (let i = 0; i < sectionId.length; i++) {
    hash = (hash << 5) - hash + sectionId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % sectionPalette.length;
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

// =============================================================================
// MAP PREVIEW COLORS
// =============================================================================

// Background gradient and grid for the static route/section map previews
// (MiniTraceView, RouteRow, SectionRow SVGs) and the Skia feed preview halo.
// Deliberately muted greens - not the brand teal.
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
  /** Start and end of a track. */
  start: 'rgba(34,197,94,0.75)',
  end: 'rgba(239,68,68,0.75)',
  /** Section creation handles, which sit above the trace and need more weight. */
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
  /** Endpoints of a neighbouring section, muted so they read as background. */
  nearbyStart: 'rgba(34,197,94,0.6)',
  nearbyEnd: 'rgba(239,68,68,0.6)',
  /** Live recording position dot. */
  userLocation: '#2196F3',
  /** The export privacy home and the radius trimmed around it. */
  homeRadius: '#0D9488',
  homeRadiusFill: 'rgba(13,148,136,0.18)',
} as const;

// =============================================================================
// LIGHT MODE COLORS
// =============================================================================

export const colors = {
  // Primary - Teal (everyday interactions)
  primary: brand.tealLight, // Teal-600 for light mode (good contrast on white)
  primaryHover: brand.tealHover, // Teal-700 for hover
  primaryLight: brand.teal, // Lighter variant

  // Accent - Gold (achievements, PRs only)
  accent: brand.goldDark, // Slightly darker gold for light mode
  accentLight: brand.gold,

  // Secondary - Blue (charts, data)
  secondary: brand.blueDark, // Darker blue for light mode
  secondaryLight: brand.blue,

  // Surfaces
  surface: '#FFFFFF',
  background: '#F8F9FA',
  backgroundAlt: '#F1F3F5',

  // Text
  textPrimary: '#18181B',
  textSecondary: '#52525B',
  textDisabled: '#A1A1AA',
  // One grey in both themes cleared 4.5:1 in neither, 4.34:1 light and 3.24:1
  // dark. These are the zinc rungs either side, already in the file as
  // verdict.neutral, at 6.95:1 and 6.10:1 on the worst ground each theme draws.
  // Muted copy is a caption or a unit, not an inactive control, so the
  // exemption textDisabled carries does not reach it.
  textMuted: '#52525B',
  textOnDark: '#FFFFFF',
  textOnPrimary: '#18181B', // Dark text on gold
  // A chevron is often the only thing saying a row opens, and an idle status
  // icon is the only thing saying the GPS is still looking, so both owe 3:1.
  // Same hue, lifted until they hold it on white, background and backgroundAlt.
  iconFaint: '#8A8A8A', // Faint chevrons / placeholder icons (dark counterpart: darkColors.iconFaint)
  iconNeutral: '#828A9A', // Idle/indeterminate status icons (GPS acquiring)
  neutralLine: '#888888', // Unselected map lines, non-navigable chevrons on dark surfaces
  warningAmber: '#92400E', // Amber warning text/icon on light amber surfaces
  // The same tone as `warningAmber` on purpose: the chip label and the banner
  // word are both amber text on a light ground, and the lighter #D97706 this
  // was read 2.86:1 on the chip's own 12% tint. The two names stay because the
  // dark halves differ, #FBBF24 here against the banner's own.
  amberIcon: '#92400E', // Amber icons/text on amber-tinted chips (dark counterpart: #FBBF24)

  // Semantic. `success` and `warning` are fills: 2.28:1 and 2.15:1 on white,
  // so neither can be the mark on a light surface, only the ground under one.
  // `successDeep` is the green that can, at 5.02:1, and it is the value the
  // verdict ladder's positive rung already uses. `warningAmber` above is the
  // amber that can, at 7.09:1. Both have a counterpart in `darkColors`, and
  // both need it: no single green clears 4.5:1 on white and on #18181B at
  // once, so a mark reads the pair through `isDark` rather than one constant.
  success: '#22C55E',
  successLight: '#4ADE80',
  successDark: '#16A34A',
  successDeep: '#15803D',
  error: '#EF4444',
  errorLight: '#F87171',
  errorDark: '#DC2626',
  // The red a word is set in. `error` is 3.38:1 on white, which is the 3:1 an
  // icon or a border owes and not the 4.5:1 text owes, so a destructive action
  // label and a failure line take this one instead: 5.82:1 on the worst light
  // surface. Same shape as `successDeep` and `warningAmber` beside it, and the
  // dark counterpart is the dark palette's own error red, 5.65:1.
  errorDeep: '#B91C1C',
  warning: '#F59E0B',
  warningLight: '#FBBF24',
  // Capacity ladder, between warning and error: a section's point budget and
  // the storage bar's cache segments.
  cautionYellow: '#FFC107',
  cautionOrange: '#FF9800',
  // The two caution hues as text. Both are fills, 1.47:1 and 1.94:1 on white,
  // and the section-size warning is set in them on a pill that is 95 per cent
  // white. 4.92:1 and 4.90:1 on the worst light surface.
  cautionYellowText: '#866400',
  cautionOrangeText: '#995B00',
  info: brand.blue,
  infoLight: brand.blueLight,
  // The info blue as text. The merge banner's line reads it over a 15% tint of
  // itself, where the fill is 2.66:1 and `infoLight` 2.00:1. 4.95:1 on the worst
  // light surface.
  infoText: '#2B6CA8',

  // Inputs
  inputTrack: '#DDDDDD', // Slider/progress track (dark counterpart: #333333)

  // Borders
  border: '#E4E4E7',
  borderLight: '#F4F4F5',
  divider: '#E4E4E7',

  // Neutral grays (Zinc scale)
  gray50: '#FAFAFA',
  gray100: '#F4F4F5',
  gray200: '#E4E4E7',
  gray300: '#D4D4D8',
  gray400: '#A1A1AA',
  gray500: '#71717A',
  gray600: '#52525B',
  gray700: '#3F3F46',
  gray800: '#27272A',
  gray900: '#18181B',

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

  // Fitness metric colors (matching intervals.icu)
  fitness: brand.blue, // CTL - Brand blue
  fatigue: '#A855F7', // ATL - Purple
  fitnessBlue: '#42A5F5', // CTL display color (intervals.icu blue)
  fatiguePurple: '#AB47BC', // ATL display color (intervals.icu purple)

  // Chart accent colors
  chartBlue: brand.blue,
  chartPurple: '#A855F7',
  chartGreen: '#10B981',
  chartYellow: '#FBBF24',
  chartCyan: '#06B6D4',
  chartPink: '#EC4899',
  chartIndigo: '#6366F1',
  chartAmber: '#F59E0B',
  chartGold: brand.gold,
  // Mark grade. The chart tones above are fills and lines, where the mark on
  // top carries the contrast. Where the mark itself is the carrier, a PR
  // trophy or the ring round the best dot, `chartGold` measures 1.89:1 on
  // white and `chartGreen` 2.28:1, under the 3:1 a graphical object owes. Same
  // hues, lifted.
  chartGoldMark: '#8A7224',
  chartGreenMark: '#15803D',
  // The gold a PR time is set in. Mark grade is not text grade: `chartGoldMark`
  // reaches 4.18:1 on white, which is the 3:1 a trophy owes and not the 4.5:1
  // text owes, and text has no 1.4.11 exemption. Same hue again, one step
  // further down, 4.91:1 on the worst of the three light surfaces.
  chartGoldText: '#7E671B',
  // The rest of the series hues that reach a text style, same rule and same
  // method. Worst of the three light surfaces: chartPinkText 5.43:1,
  // chartPurpleText 6.28:1, fitnessBlueText 5.30:1, fatiguePurpleText 6.33:1.
  // The fills they darken are 3.17, 3.56, 2.66 and 4.33, and text has no
  // 1.4.11 exemption.
  chartPinkText: '#BE185D',
  chartPurpleText: '#7E22CE',
  // The chart accent as text: the eFTP marker label reads in it, and the teal
  // the dots are drawn in is 3.37:1 on white, which is a mark's bar and not
  // text's. 4.92:1 on the worst light surface.
  chartAccentText: '#0F766E',
  fitnessBlueText: '#0F62C4',
  fatiguePurpleText: '#8E24AA',
  chartRed: '#EF4444',
  chartCasing: '#00000026', // Under-stroke behind chart lines for edge contrast

  // Wellness metric colors
  chartHrv: '#EC4899', // Pink-500
  chartRhr: '#EF4444', // Red-500
  chartSleep: '#A855F7', // Purple-500
  chartSleepScore: '#6366F1', // Indigo-500
  chartWeight: '#64748B', // Slate-500
  chartFtp: '#FFB300', // Amber - FTP trend (stable across themes)
  // The same amber as text: the estimated-FTP headline reads in it, and
  // `chartFtp` is 1.61:1 on white. 4.91:1 on the worst light surface.
  chartFtpText: '#8B6200',
  chartPowerCurve: brand.blue, // Power curve line
  chartPaceCurve: '#4CAF50', // Green - pace curve line
  chartSwimCurve: '#2196F3', // Blue - swim pace curve line
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

  // Semantic UI colors
  highlight: brand.blue,
  highlightAlt: brand.blueLight,
  shadowBlack: '#000000',
  transparent: 'transparent',

  // Direction indicator colors
  sameDirection: brand.blue,
  reverseDirection: '#EC4899', // Pink
  consensusRoute: brand.gold, // Gold for main route

  // Form zone colors (matching intervals.icu)
  formTransition: '#64B5F6', // Light blue - transition zone
  formFresh: '#81C784', // Light green - ready for events
  formGreyZone: '#9E9E9E', // Grey - neutral zone
  formOptimal: '#66BB6A', // Green - peak training zone
  formHighRisk: '#EF5350', // Red - overtrained

  // Form zone text. The fills above are bands and sparkline runs, grounds that
  // 1.4.11 exempts at 3:1; a form number or a zone name drawn in one is text and
  // holds 4.5:1 on every light surface, which none of the fills reach.
  // `formOptimalText` also carries the efficiency headline and effort count,
  // which sit on an 18% tint of the fill, so it is the darkest of the five.
  // The five keep the fills' order, optimal darker than fresh.
  formTransitionText: '#1565C0',
  formFreshText: '#2E7D32',
  formGreyZoneText: '#616161',
  formOptimalText: '#1B5E20',
  formHighRiskText: '#C62828',

  // Event priority colors
  eventPriorityA: '#EC4899', // Pink - priority race
  eventPriorityB: '#F59E0B', // Amber - secondary
  eventPriorityC: '#71717A', // Gray - training

  // Workout step colors
  workoutCooldown: '#8B5CF6',

  // Insight category colors
  insightGold: '#D4AF37', // brand.gold - unified PR color
  insightStrength: brand.tealLight, // teal for strength progression

  // Warning banner colors
  warningBannerBg: '#451A03',
  warningBannerText: '#FDE68A',

  // Tappable reference link inside an insight's methodology note
  // Teal-700. The lighter #009688 read 3.30:1, and a link that carries its
  // affordance in colour owes the text bar twice over.
  linkTeal: '#00796B',

  // Compass
  compassNorth: '#E53935',

  // Mark-grade tones. The palette has three families: text at 4.5:1, a mark
  // at 3:1, a ground at no bar. These are the mark tones for hues whose fill
  // token sits under 3:1 on the light theme, so a border, a legend swatch or
  // a bar that is the only carrier of its meaning has one to take. Each holds
  // 3:1 against all three surfaces of both themes, which is why they are one
  // set rather than a light and a dark pair.
  markCyan: '#0891B2',
  markGreen: '#059669',
  markAmber: '#BE5A0A',
  markYellow: '#B57200',
  markOrange: '#CC6A00',

  // Four of the five form zones as marks: a legend dot, not the band it keys.
  // `formHighRisk` is already 3.13:1 on the worst surface and keeps its fill.
  markFormTransition: '#1B7FD8',
  markFormFresh: '#3D9140',
  markFormGreyZone: '#7A7A7A',
  markFormOptimal: '#2E8C33',
} as const;

// =============================================================================
// CHART STREAM COLORS
// =============================================================================

// One colour per activity data stream (activity charts via chartConfig.ts).
// Picked for contrast against both themes and against each other; wbal shares
// cadence's orange because the two never plot together.
export const chartStreamColors = {
  // Power and gap take the mark tones: the line is the only thing telling one
  // series from another on the canvas and the chip that keys it is the same
  // hue, so both move together.
  power: colors.markYellow,
  heartrate: '#E63946',
  cadence: '#F97316',
  speed: '#2A9D8F',
  pace: '#818CF8',
  elevation: '#A3E635',
  grade: '#6B8E23',
  wbal: '#F97316',
  gap: colors.markCyan,
  distance: '#457B9D',
  temp: '#E76F51',
  time: '#6C757D',
} as const;

// Style-picker chip swatches (map style selection): one representative
// background per map style. Theme-independent - each depicts the style itself.
export const mapStyleSwatch = {
  light: '#E5E7EB',
  dark: '#374151',
  satellite: '#1E6B5A',
} as const;

// Static thumbnails for the map style picker. Each is the style's own land,
// water and road tint, so a viewer recognises the style without the app having
// to run three live maps to draw three 70px circles.
export const mapStylePreview = {
  light: { land: '#EFEDE7', water: '#A5CFE3', road: '#FFFFFF' },
  dark: { land: '#1F2933', water: '#20405C', road: '#3E4C59' },
  satellite: { land: '#2F5E3A', water: '#1B4A63', road: '#C9BFA5' },
} as const;

// The two insight tones the verdict ladder has no rung for, because they are
// categories rather than judgements. Theme-independent; `info` mirrors
// fitnessBlue. Every polarity resolves through the ladder instead, so a tone
// added here that `insightToneColor` does not return is unreachable.
export const insightIcon = {
  info: '#42A5F5',
  opportunity: '#FF9800',
} as const;

// Status badge palette (strength balance/progression chips): translucent fill
// (hex alpha) with a deeper text tone of the same hue. The *Strong variants
// carry the denser 0x26 fill used on progression cards.
export const statusBadge = {
  good: { bg: '#22C55E18', text: '#15803D' },
  alert: { bg: '#F9731618', text: '#B45309' },
  watch: { bg: '#F59E0B18', text: '#B45309' },
  bad: { bg: '#EF444418', text: '#B91C1C' },
  // The denser fill takes a deeper text tone than its plain rung: the same
  // green on the 0x26 fill reads 4.41:1 where it reads 4.64:1 on the 0x18 one,
  // and the same amber lands exactly on the bar with no headroom.
  goodStrong: { bg: '#22C55E26', text: '#166534' },
  watchStrong: { bg: '#F59E0B26', text: '#92400E' },
  neutralStrong: { bg: '#64748B26', text: '#475569' },
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
// replaces, the fill is the rung itself at the two alpha steps the strength
// chips already used: 0x18 for a chip and 0x26 for the denser progression
// card. The text on it stays `verdictColor`, so a chip is one hue at two
// weights and the ladder still decides which hue.
export function verdictFill(rung: VerdictRung, isDark: boolean, strong = false): string {
  return `${verdictColor(rung, isDark)}${strong ? '26' : '18'}`;
}

// What an insight's icon is drawn from. A polarity is a ladder rung; `info`
// and `opportunity` are categories rather than judgements, so the ladder has
// no rung for them and they keep their own tones.
export type InsightTone = VerdictRung | 'info' | 'opportunity';

export function insightToneColor(tone: InsightTone, isDark: boolean): string {
  if (tone === 'info') return insightIcon.info;
  if (tone === 'opportunity') return insightIcon.opportunity;
  return verdictColor(tone, isDark);
}

// Recording, which is its own meaning rather than an accent. The brand teal
// is what every other action on the feed is painted in, so a record button
// wearing it reads as one more of them. Red is the convention a record control
// has carried since tape, and it is the one colour in this palette that is not
// already spent on something else. Both tones carry the white glyph at AA text
// and separate from the surface they float over at the graphical-object bar:
// light 6.22:1 and 5.90:1, dark 4.83:1 and 4.02:1. Dark is the lighter tone,
// the same way round as every other pair here.
export const recording = {
  light: '#C1121F',
  dark: '#DC2626',
} as const;

// Sync-warning banner palette (root layout): amber surfaces with deep amber
// text, one set per mode.
export const amberBanner = {
  light: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', subtext: '#B45309' },
  dark: { bg: '#3F2A17', border: '#92400E', text: '#FDE68A', subtext: '#FCD34D' },
} as const;

// Error-banner counterpart to amberBanner: red surfaces for a failure notice.
export const redBanner = {
  bg: '#FEE2E2',
  border: '#EF4444',
  text: '#991B1B',
} as const;

// GitHub-style contribution ramp for the activity heatmap grid: five steps
// from "no activity" upward, one set per mode.
export const contributionRamp = {
  dark: ['#161B22', '#0E4429', '#006D32', '#26A641', '#39D353'],
  light: ['#EBEDF0', '#9BE9A8', '#40C463', '#30A14E', '#216E39'],
} as const;

// The crash screen paints itself before any theme provider is mounted, so it
// carries its own dark chrome rather than reading one.
export const errorScreen = {
  bg: '#1A1A1A',
  title: '#FFFFFF',
  detail: '#999999',
  message: '#FF6B6B',
  action: '#0D9488',
} as const;

// Muscle body diagram: the base fill under the volume ramp, one per mode, and
// the outline on the selected group, also one per mode. The outline runs along
// the polygon boundaries, which are the page showing through rather than the
// fill, so a near-black stroke that reads at 17:1 on the light page is drawn in
// the colour of the dark one.
export const bodyDiagram = {
  fillLight: '#3F3F3F',
  fillDark: '#555555',
  selectedStroke: '#1A1A1A',
  selectedStrokeDark: '#FAFAFA',
} as const;

// The one-frame Skia warmup surface. Primaries on purpose: it compiles the
// shaders and is never seen.
export const shaderWarmup = {
  gradientStart: '#FF0000',
  gradientEnd: '#00FF00',
  line: '#888888',
  rect: '#333333',
  shadow: '#000000',
} as const;

// Switch track when the switch is off, one per mode. Heavier than inputTrack:
// a switch reads as a control, a progress rail does not.
export const switchTrackOff = {
  light: '#DDDDDD',
  dark: '#444444',
} as const;

// The QR scanner covers the screen with the camera feed, so its chrome is
// fixed against the preview rather than following the theme.
export const cameraOverlay = {
  bg: '#000000',
  text: '#FFFFFF',
  hint: '#999999',
} as const;

// Icon drawn over a mapStyleSwatch chip: dark on the light swatch, white on
// the other two.
export const mapStyleSwatchIcon = {
  light: '#6B7280',
  dark: '#FFFFFF',
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
  // Primary - Teal (for dark mode)
  primary: brand.tealDark, // Teal-400 for dark mode (good contrast on dark)
  primaryHover: brand.tealHoverDark, // Teal-500 for hover
  primaryLight: '#5EEAD4', // Teal-300 for subtle highlights

  // Accent - Gold (achievements, PRs only)
  accent: brand.gold, // Full gold for dark mode
  accentLight: brand.goldLight,

  // Mark grade, the dark half of the pair in `colors`. A near-black surface
  // wants the light tone where white wants the deep one, so a mark that reads
  // one token in both themes is the same defect the other way round.
  chartGoldMark: brand.goldLight,
  chartGreenMark: '#86EFAC',

  // Secondary - Blue (charts, data)
  secondary: brand.blue, // Full blue for dark mode
  secondaryLight: brand.blueLight,

  // Surfaces (near-black, premium feel)
  background: '#0D0D0F',
  backgroundAlt: '#111114',
  surface: '#18181B',
  surfaceElevated: '#1F1F23',
  surfaceCard: '#232328',
  surfaceOverlay: 'rgba(24, 24, 27, 0.95)',

  // Text
  textPrimary: '#FAFAFA',
  textSecondary: '#A1A1AA',
  textMuted: '#A1A1AA',
  textDisabled: '#52525B',

  // Borders
  border: '#27272A',
  borderLight: '#3F3F46',
  borderAccent: 'rgba(45, 212, 191, 0.15)', // Subtle teal glow (updated from blue)
  divider: '#27272A',

  // Icon colors
  iconPrimary: '#FAFAFA',
  iconSecondary: '#A1A1AA',
  iconMuted: '#71717A',
  iconDisabled: '#52525B',
  iconFaint: '#71717A', // Faint chevrons / placeholder icons (light counterpart: #8A8A8A)
  iconNeutral: '#9CA3AF', // Idle/indeterminate status icons; 6.16:1 on the dark surfaces
  amberIcon: '#FBBF24', // Amber icons/text on amber-tinted chips (light counterpart: #92400E)
  inputTrack: '#333333', // Slider/progress track (light counterpart: #DDDDDD)

  // Amber warning text/icon (counterpart to light warningAmber)
  warningAmber: '#FBBF24',

  // Counterpart to light errorDeep. The dark palette's error red already clears
  // the text bar on a near-black surface at 5.65:1, so the pair is one token
  // read through isDark and not two hues.
  errorDeep: '#F87171',

  // Counterpart to light successDeep: on a near-black surface the mark has to
  // be the light tone, not the dark one. 10.17:1 on #18181B.
  successDeep: '#4ADE80',

  // Interactive states
  buttonSecondary: '#27272A',
  inputBackground: '#1F1F23',

  // Semantic overrides
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',

  // Zone overrides for dark mode
  zone7: '#B0B0B0', // Zone 7 visibility override (light gray on dark bg)

  // Chart colors for dark mode (optimized for visibility)
  chartFitness: brand.blueLight, // Brighter blue for CTL
  chartFatigue: '#C084FC', // Brighter purple for ATL
  chartForm: brand.blueLight, // Brighter blue for TSB (neutral, zone-based at runtime)
  chartHR: '#F87171', // Red for heart rate
  chartCadence: '#C084FC', // Purple for cadence
  chartElevation: '#94A3B8', // Slate for elevation
  chartCasing: '#00000080', // Under-stroke behind chart lines for edge contrast

  // Wellness metric colors for dark mode (one Tailwind step lighter)
  chartHrv: '#F472B6', // Pink-400
  chartRhr: '#F87171', // Red-400
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
  chartGoldText: brand.gold,
  chartFtpText: '#FFB300',
  // The B950 half of the pair. On the dark surfaces `fitnessBlue` already
  // carries at 5.91:1 and is its own text tone; pink, purple and the fatigue
  // purple do not (4.43, 3.95 and 3.25) and take a lighter step, 5.91:1,
  // 5.92:1 and 6.55:1 on the worst of the three.
  chartPinkText: '#F472B6',
  chartPurpleText: '#C084FC',
  // The dark teal is a light tone on a near-black ground and carries as it is,
  // 8.40:1 on the worst dark surface.
  chartAccentText: brand.tealDark,
  fitnessBlueText: '#42A5F5',
  fatiguePurpleText: '#CE93D8',
  rideText: '#4F8FF7',
  runText: '#10B981',
  swimText: '#06B6D4',
  // The B959 half. On a near-black ground the caution fills carry as they are,
  // 9.60:1 and 7.26:1, and the info blue's own light step does at 7.02:1. The
  // tappable link teal had no dark counterpart at all, so a dark theme read the
  // light one: this is the dark tone the theme already uses for the primary,
  // 8.40:1 on the worst dark surface.
  cautionYellowText: '#FFC107',
  cautionOrangeText: '#FF9800',
  infoText: brand.blueLight,
  linkTeal: brand.tealDark,

  // The rest of the form zone text family. Same story: four of the five
  // are the fill, and the red is the one that does not carry, 4.49:1 on
  // surfaceCard, so it takes the lighter tone the dark palette uses for error.
  formTransitionText: '#64B5F6',
  formFreshText: '#81C784',
  formGreyZoneText: '#9E9E9E',
  formOptimalText: '#66BB6A',
  formHighRiskText: '#F87171',
} as const;

// =============================================================================
// GRADIENTS
// =============================================================================

export const gradients = {
  // Primary - Teal (for buttons, CTAs)
  primary: ['#2DD4BF', '#14B8A6'] as const, // Teal gradient
  primaryLight: ['#5EEAD4', '#2DD4BF'] as const,

  // Accent - Gold (achievements only)
  gold: [brand.goldLight, brand.gold] as const,
  accent: [brand.goldLight, brand.gold] as const, // Alias

  // Secondary - Blue (charts, data)
  blue: [brand.blueLight, brand.blue] as const,
  secondary: [brand.blueLight, brand.blue] as const, // Alias

  // Legacy/premium (gold to blue for special moments)
  premium: [brand.gold, brand.blue] as const,

  // Fitness metric gradients
  fitness: [brand.blueLight, brand.blue] as const,
  fatigue: ['#C084FC', '#A855F7'] as const, // Purple gradient

  // UI gradients
  success: ['#4ADE80', '#22C55E'] as const,
  warning: ['#FBBF24', '#F59E0B'] as const,
  purple: ['#C084FC', '#A855F7'] as const,
  ocean: ['#22D3EE', '#06B6D4'] as const, // Cyan

  // Surface gradients
  dark: ['rgba(31,31,35,0.95)', 'rgba(24,24,27,0.98)'] as const,
  light: ['rgba(255,255,255,0.98)', 'rgba(248,249,250,0.95)'] as const,
  glass: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.02)'] as const,
  glassDark: ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.01)'] as const,
  cardDark: ['#1F1F23', '#18181B'] as const,
} as const;

// =============================================================================
// GLOWS (for premium "pop" effects)
// =============================================================================

export const glows = {
  primary: 'rgba(20, 184, 166, 0.4)', // Teal glow for interactive elements
  teal: 'rgba(20, 184, 166, 0.4)', // Alias
  gold: 'rgba(212, 175, 55, 0.4)', // For achievements only
  accent: 'rgba(212, 175, 55, 0.4)', // Alias
  blue: 'rgba(91, 155, 213, 0.4)',
  success: 'rgba(34, 197, 94, 0.4)',
  warning: 'rgba(245, 158, 11, 0.4)',
  error: 'rgba(239, 68, 68, 0.4)',
  purple: 'rgba(168, 85, 247, 0.4)',
} as const;

// =============================================================================
// OPACITY SCALE
// =============================================================================

export const opacity = {
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

// =============================================================================
// INSIGHT CATEGORY COLORS
// =============================================================================

export const insightCategoryColors: Record<string, string> = {
  section_pr: colors.insightGold,
  fitness_milestone: colors.success,
  period_comparison: brand.blue,
  strength_progression: colors.insightStrength,
  strength_balance: colors.error,
  hrv_trend: colors.formOptimal,
  stale_pr: colors.warning,
};
