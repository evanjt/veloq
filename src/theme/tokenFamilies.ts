/**
 * Which bar each palette token answers to.
 *
 * Q246 settled the rule as WCAG 2.2 AA's own three families, and Q129 set
 * AA as the target. Text holds 4.5:1 on the ground it is drawn on. A mark holds
 * 3:1: something required to identify a control or to understand a graphic, a
 * status icon, a focus border, a legend swatch, a chevron that is the only
 * affordance. A ground holds no bar: a surface, a divider, the zinc scale, a
 * band fill, a chart series the chart labels another way, which is 1.4.11's
 * exemption.
 *
 * The table is the rule. `textContrast.test.ts` reads it, measures every text
 * and mark token against its grounds in the theme it lives in, and fails on an
 * unclassified token, so a token added tomorrow has to be put in a family
 * before it can land. A token that is under its bar today is in `UNDER_BAR`
 * with the item that owns the repair, and that list only shortens.
 *
 * A family belongs to the token, not to the site. Where a hue was drawn as all
 * three, the text sites took a `*Text` variant (B927, B928) and the marks a
 * `mark*` or `*Mark` one (B929, B930), which is what let the fill be called
 * a ground here.
 */

export type TokenFamily = 'text' | 'mark' | 'ground';

/** WCAG 2.2 AA, 1.4.3 for text and 1.4.11 for a non-text mark. */
export const FAMILY_BARS: Record<TokenFamily, number> = {
  text: 4.5,
  mark: 3,
  ground: 0,
};

/**
 * Every key of `colors` and `darkColors`. The other exports in `colors.ts` are
 * surface-specific pairs that name their own ground, `statusBadge`, `verdict`,
 * `amberBanner` and the rest, and are guarded where they are drawn rather than
 * here (S46).
 */
export const TOKEN_FAMILIES: Record<string, TokenFamily> = {
  // Text. The three body tokens, the pairs that sit on a filled ground, and the
  // variants B927 and B928 cut out of the series and zone hues.
  textPrimary: 'text',
  textSecondary: 'text',
  textMuted: 'text',
  textDisabled: 'text',
  textOnDark: 'text',
  textOnPrimary: 'text',
  warningAmber: 'text',
  amberIcon: 'text',
  successDeep: 'text',
  errorDeep: 'text',
  errorDark: 'mark',
  linkTeal: 'text',
  cautionYellowText: 'text',
  cautionOrangeText: 'text',
  infoText: 'text',
  warningBannerText: 'text',
  rideText: 'text',
  runText: 'text',
  swimText: 'text',
  chartGoldText: 'text',
  chartFtpText: 'text',
  chartPinkText: 'text',
  chartPurpleText: 'text',
  chartAccentText: 'text',
  fitnessBlueText: 'text',
  fatiguePurpleText: 'text',
  formTransitionText: 'text',
  formFreshText: 'text',
  formGreyZoneText: 'text',
  formOptimalText: 'text',
  formHighRiskText: 'text',

  // Marks. A control's own colour, an icon, a chevron, a ring, a legend swatch.
  primary: 'mark',
  iconPrimary: 'mark',
  iconSecondary: 'mark',
  iconMuted: 'mark',
  iconDisabled: 'mark',
  iconFaint: 'mark',
  iconNeutral: 'mark',
  neutralLine: 'mark',
  compassNorth: 'mark',
  chartFormLine: 'mark',
  chartGoldMark: 'mark',
  chartGreenMark: 'mark',
  markCyan: 'mark',
  markGreen: 'mark',
  markAmber: 'mark',
  markYellow: 'mark',
  markOrange: 'mark',
  markFormTransition: 'mark',
  markFormFresh: 'mark',
  markFormGreyZone: 'mark',
  markFormOptimal: 'mark',

  // Grounds: the surfaces themselves and anything drawn as one.
  surface: 'ground',
  background: 'ground',
  backgroundAlt: 'ground',
  surfaceElevated: 'ground',
  surfaceCard: 'ground',
  surfaceOverlay: 'ground',
  inputBackground: 'ground',
  buttonSecondary: 'ground',
  border: 'ground',
  borderLight: 'ground',
  borderAccent: 'ground',
  divider: 'ground',
  inputTrack: 'ground',
  shadowBlack: 'ground',
  transparent: 'ground',
  gray50: 'ground',
  gray100: 'ground',
  gray200: 'ground',
  gray300: 'ground',
  gray400: 'ground',
  gray500: 'ground',
  gray600: 'ground',
  gray700: 'ground',
  gray800: 'ground',
  gray900: 'ground',

  // Brand and semantic fills. `success`, `warning` and the caution pair are the
  // ground under a mark and never the mark itself, which is what B606 settled
  // when it moved their call sites onto `successDeep` and `warningAmber`.
  primaryHover: 'ground',
  primaryLight: 'ground',
  accent: 'ground',
  accentLight: 'ground',
  secondary: 'ground',
  secondaryLight: 'ground',
  highlight: 'ground',
  highlightAlt: 'ground',
  success: 'ground',
  successLight: 'ground',
  successDark: 'ground',
  error: 'ground',
  errorLight: 'ground',
  warning: 'ground',
  warningLight: 'ground',
  cautionYellow: 'ground',
  cautionOrange: 'ground',
  info: 'ground',
  infoLight: 'ground',
  warningBannerBg: 'ground',
  insightGold: 'ground',
  insightStrength: 'ground',
  eventPriorityA: 'ground',
  eventPriorityB: 'ground',
  eventPriorityC: 'ground',
  workoutCooldown: 'ground',

  // Sport and fitness fills.
  ride: 'ground',
  run: 'ground',
  swim: 'ground',
  walk: 'ground',
  hike: 'ground',
  workout: 'ground',
  fitness: 'ground',
  fatigue: 'ground',
  fitnessBlue: 'ground',
  fatiguePurple: 'ground',
  zone7: 'ground',

  // Chart series and overlays. I170 read every one of these against 1.4.11:
  // the lines sit between labelled axes with the value printed at the crosshair,
  // the bands have a y-axis, the zero rule has its `0`, so the chart carries the
  // information without the hue.
  chartBlue: 'ground',
  chartPurple: 'ground',
  chartGreen: 'ground',
  chartYellow: 'ground',
  chartCyan: 'ground',
  chartPink: 'ground',
  chartIndigo: 'ground',
  chartAmber: 'ground',
  chartGold: 'ground',
  chartRed: 'ground',
  chartCasing: 'ground',
  chartHrv: 'ground',
  chartRhr: 'ground',
  chartSleep: 'ground',
  chartSleepScore: 'ground',
  chartWeight: 'ground',
  chartFtp: 'ground',
  chartPowerCurve: 'ground',
  chartPaceCurve: 'ground',
  chartSwimCurve: 'ground',
  chartGuideLine: 'ground',
  chartPreviousSeason: 'ground',
  chartGridFaint: 'ground',
  chartZeroLine: 'ground',
  chartMutedBar: 'ground',
  chartDotMuted: 'ground',
  chartBandWarmup: 'ground',
  chartBandCooldown: 'ground',
  chartBandNeutral: 'ground',
  chartZeroLineSolid: 'ground',
  chartFitness: 'ground',
  chartFatigue: 'ground',
  chartForm: 'ground',
  chartHR: 'ground',
  chartCadence: 'ground',
  chartElevation: 'ground',

  // Map lines and zone fills. A map line is drawn over tiles behind a casing,
  // so the surface it is measured against is not a palette token at all, and the
  // direction it means is in the label beside it.
  sameDirection: 'ground',
  reverseDirection: 'ground',
  consensusRoute: 'ground',
  formTransition: 'ground',
  formFresh: 'ground',
  formGreyZone: 'ground',
  formOptimal: 'ground',
  formHighRisk: 'ground',
};

/**
 * Tokens drawn on something other than their theme's three surfaces. The value
 * is the ground token, in the same theme, that the pair is measured against.
 */
export const TOKEN_GROUNDS: Record<string, readonly string[]> = {
  // `primary` is no longer under white: the filled teal controls carry the
  // dark ink, and neither is `info` any more. The one ground left is the
  // demo banner's dark-mode fill, `secondary`, which carries white at 4.51:1
  // where dark ink on it is 3.93:1.
  textOnDark: ['secondary'],
  textOnPrimary: ['accent', 'accentLight', 'primary'],
  warningBannerText: ['warningBannerBg'],
};

/**
 * Tokens the standard itself lets off, with the clause. An exemption is written
 * down beside the token, which is not the same as a gap nobody noticed.
 */
export const FAMILY_EXEMPTIONS: Record<string, string> = {
  textDisabled: 'WCAG 1.4.3 exempts text on an inactive control.',
  iconDisabled: 'WCAG 1.4.11 exempts an inactive component, the icon half of textDisabled.',
};

/**
 * Tokens under their family's bar today, each with the item that owns the
 * repair. Every entry is a measured failure, not an exemption: the list only
 * shortens, and an entry that has been fixed fails its own test rather than
 * going quiet.
 */
export const UNDER_BAR: Record<string, string> = {};
