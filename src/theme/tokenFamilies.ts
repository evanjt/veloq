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
 * three, the text sites took a `*Text` variant and the marks a
 * `mark*` or `*Mark` one, which is what let the fill be called
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
 * surface-specific pairs that name their own ground, `verdict`, `recording`
 * and the rest, and are guarded where they are drawn rather than here.
 */
export const TOKEN_FAMILIES: Record<string, TokenFamily> = {
  // The interface roles, read under each role's own name, in the family
  // `ROLE_FAMILIES` gives the role.
  surfacePage: 'ground',
  surface: 'ground',
  surfaceRaised: 'ground',
  surfaceInput: 'ground',
  fillNeutral: 'ground',
  stateHover: 'ground',
  statePressed: 'ground',
  textPrimary: 'text',
  textSecondary: 'text',
  textTertiary: 'text',
  textDisabled: 'text',
  textOnFill: 'text',
  textOnBright: 'text',
  iconSecondary: 'mark',
  iconMuted: 'mark',
  border: 'ground',
  cardEdge: 'ground',
  borderStrong: 'ground',
  track: 'mark',
  controlBoundary: 'mark',
  actionPrimary: 'ground',
  actionPrimaryHover: 'ground',
  actionSecondary: 'ground',
  actionLink: 'text',
  focusRing: 'mark',
  controlOn: 'mark',
  achievement: 'mark',
  achievementText: 'text',
  compassNorth: 'mark',
  successText: 'text',
  successBg: 'ground',
  successFill: 'ground',
  warningText: 'text',
  warningBg: 'ground',
  warningFill: 'ground',
  errorText: 'text',
  errorBg: 'ground',
  dangerFill: 'ground',
  infoBg: 'ground',

  // Text: the variants cut out of the series and zone hues.
  chartFtpText: 'text',
  chartPinkText: 'text',
  chartHrvText: 'text',
  chartRhrText: 'text',
  chartPurpleText: 'text',
  fitnessBlueText: 'text',
  fatiguePurpleText: 'text',
  formTransitionText: 'text',
  formFreshText: 'text',
  formGreyZoneText: 'text',
  formOptimalText: 'text',
  formHighRiskText: 'text',

  // Marks: a ring, a legend swatch, a mark tone of a data hue.
  chartFormLine: 'mark',
  chartGreenMark: 'mark',
  chartSeries: 'mark',
  markCyan: 'mark',

  // Fills that have not folded into a role yet.
  secondary: 'ground',

  // Fitness fills.
  fitness: 'ground',
  fatigue: 'ground',

  // Chart series and overlays. I170 read every one of these against 1.4.11:
  // the lines sit between labelled axes with the value printed at the crosshair,
  // the bands have a y-axis, the zero rule has its `0`, so the chart carries the
  // information without the hue.
  chartPurple: 'ground',
  chartCyan: 'ground',
  chartPink: 'ground',
  chartAmber: 'ground',
  chartHrv: 'ground',
  chartRhr: 'ground',
  chartFtp: 'ground',
  chartGuideLine: 'ground',
  chartForm: 'ground',

  // Map lines and zone fills. A map line is drawn over tiles behind a casing,
  // so the surface it is measured against is not a palette token at all, and the
  // direction it means is in the label beside it.
  formTransition: 'ground',
  formFresh: 'ground',
  formGreyZone: 'ground',
  formOptimal: 'ground',
  formHighRisk: 'ground',
};

/**
 * Every colour role in the token file, by the same three families. The ramp
 * steps (`neutral-*`, `blue-*`, `gold-*`) are not roles, only what roles are
 * built from, and the `map-*` tokens are drawn over map tiles rather than a
 * palette surface, so neither is listed. A role the token file adds has to be
 * put in a family before the contrast test passes.
 */
export const ROLE_FAMILIES: Record<string, TokenFamily> = {
  'surface-page': 'ground',
  surface: 'ground',
  'surface-raised': 'ground',
  'surface-input': 'ground',
  'fill-neutral': 'ground',
  'state-hover': 'ground',
  'state-pressed': 'ground',
  scrim: 'ground',
  'text-primary': 'text',
  'text-secondary': 'text',
  'text-tertiary': 'text',
  'text-disabled': 'text',
  'text-on-fill': 'text',
  'text-on-bright': 'text',
  'text-on-gold': 'text',
  'icon-secondary': 'mark',
  'icon-muted': 'mark',
  border: 'ground',
  'card-edge': 'ground',
  'border-strong': 'ground',
  track: 'mark',
  'control-boundary': 'mark',
  'action-primary': 'ground',
  'action-primary-hover': 'ground',
  'action-secondary': 'ground',
  'action-link': 'text',
  'focus-ring': 'mark',
  'control-on': 'mark',
  'brand-blue': 'ground',
  achievement: 'mark',
  'achievement-text': 'text',
  'achievement-bg': 'ground',
  'achievement-on-bg': 'text',
  'section-badge': 'ground',
  'section-badge-ink': 'text',
  'compass-north': 'mark',
  'success-text': 'text',
  'success-bg': 'ground',
  'success-fill': 'ground',
  'warning-text': 'text',
  'warning-bg': 'ground',
  'warning-fill': 'ground',
  'error-text': 'text',
  'error-bg': 'ground',
  'danger-fill': 'ground',
  record: 'ground',
  'info-bg': 'ground',
  'sport-ride': 'mark',
  'sport-winter': 'mark',
  'sport-run': 'mark',
  'sport-water': 'mark',
  'sport-foot': 'mark',
  'sport-strength': 'mark',
  'sport-ride-2': 'mark',
  'sport-ride-3': 'mark',
  'sport-winter-2': 'mark',
  'sport-winter-3': 'mark',
  'sport-run-2': 'mark',
  'sport-run-3': 'mark',
  'sport-water-2': 'mark',
  'sport-water-3': 'mark',
  'sport-foot-2': 'mark',
  'sport-foot-3': 'mark',
  'sport-strength-2': 'mark',
  'sport-strength-3': 'mark',
  'sport-other': 'mark',
  'data-seq-1': 'mark',
  'data-seq-2': 'mark',
  'data-seq-3': 'mark',
  'data-seq-4': 'mark',
  'data-seq-5': 'mark',
  'data-div-cool-1': 'mark',
  'data-div-cool-2': 'mark',
  'data-div-cool-3': 'mark',
  'data-div-warm-1': 'mark',
  'data-div-warm-2': 'mark',
  'data-div-warm-3': 'mark',
  'data-div-mid': 'mark',
  'chart-series': 'mark',
  'chart-muted': 'ground',
  'chart-grid': 'ground',
  'chart-axis': 'mark',
  'chart-reference': 'mark',
  'chart-crosshair': 'mark',
  'direction-forward': 'mark',
  'direction-reverse': 'mark',
  'stream-power': 'mark',
  'stream-heartrate': 'mark',
  'stream-cadence': 'mark',
  'stream-speed': 'mark',
  'stream-gap': 'mark',
  'stream-wbal': 'mark',
  'stream-context': 'ground',
  'stream-context-line': 'mark',
  'zone-1': 'mark',
  'zone-2': 'mark',
  'zone-3': 'mark',
  'zone-4': 'mark',
  'zone-5': 'mark',
  'zone-6': 'mark',
  'zone-7': 'mark',
  'fitness-ctl': 'mark',
  'fatigue-atl': 'mark',
};

/** The surfaces every text and mark role is measured on, in its own theme. */
export const ROLE_SURFACES = ['surface-page', 'surface', 'surface-raised'] as const;

/**
 * Inks drawn on a fill rather than on a surface, measured on the fills they
 * name and nowhere else.
 */
export const ROLE_FILLS: Record<string, readonly string[]> = {
  'text-on-fill': ['action-primary', 'action-primary-hover', 'brand-blue', 'danger-fill', 'record'],
  'text-on-bright': ['achievement', 'success-fill', 'warning-fill'],
  'text-on-gold': ['achievement'],
  'section-badge-ink': ['section-badge'],
  'achievement-on-bg': ['achievement-bg'],
};

/**
 * Roles drawn on a tint or a well as well as on the surfaces, measured on both:
 * a status text on its own tint, the body inks on the input well and the
 * notice tints.
 */
export const ROLE_TINTS: Record<string, readonly string[]> = {
  'text-primary': [
    'surface-input',
    'fill-neutral',
    'success-bg',
    'warning-bg',
    'error-bg',
    'info-bg',
  ],
  'text-secondary': ['surface-input', 'fill-neutral'],
  'text-tertiary': ['surface-input'],
  'success-text': ['success-bg'],
  'warning-text': ['warning-bg'],
  'error-text': ['error-bg'],
  'action-link': ['info-bg'],
};

/** Roles the standard lets off, with the clause. */
export const ROLE_EXEMPTIONS: Record<string, string> = {
  'text-disabled': 'WCAG 1.4.3 exempts text on an inactive control.',
};

/**
 * Every key of `brand`. These hues resolve in neither theme, so none can be a
 * text colour: a blue that reads on white is too dark on near-black, and the
 * gold is 2.10:1 on white. A word in the action blue takes `actionLink`, one in
 * the gold takes `achievementText`, each read for the theme it is drawn in. The
 * same holds for a sport's mark colour from `sportMarkColour`: its words take
 * the body ink. `ground-token-text` refuses each as a Text colour.
 */
export const BRAND_FAMILIES: Record<string, TokenFamily> = {
  // A selected tick, a slider handle, a trophy beside its label.
  blue600: 'mark',
  blue550: 'mark',
  gold: 'mark',
  goldLight: 'mark',
  goldDark: 'mark',
  // Hover tones, gradient stops and the chart blue.
  blue700: 'ground',
  blue: 'ground',
  blueLight: 'ground',
  blueDark: 'ground',
};

/**
 * Tokens drawn on something other than their theme's three surfaces. The value
 * is the ground token, in the same theme, that the pair is measured against.
 */
export const TOKEN_GROUNDS: Record<string, readonly string[]> = {
  // White sits on the filled primary and on the destructive fill. The bright
  // fills take the dark ink instead.
  textOnFill: ['actionPrimary', 'dangerFill'],
  textOnBright: ['achievement', 'successFill', 'warningFill'],
};

/**
 * Tokens drawn on a status tint as well as on their theme's surfaces. The
 * body ink carries a notice's title and detail on every tint, and each tone's
 * text role is its icon and its words on its own tint. Measured on these and
 * on the surfaces both.
 */
export const TINT_GROUNDS: Record<string, readonly string[]> = {
  textPrimary: ['errorBg', 'warningBg', 'infoBg', 'successBg'],
  textSecondary: ['errorBg', 'warningBg', 'infoBg', 'successBg'],
  errorText: ['errorBg'],
  warningText: ['warningBg'],
  actionLink: ['infoBg'],
  successText: ['successBg'],
};

/**
 * Tokens the standard itself lets off, with the clause. An exemption is written
 * down beside the token, which is not the same as a gap nobody noticed.
 */
export const FAMILY_EXEMPTIONS: Record<string, string> = {
  textDisabled: 'WCAG 1.4.3 exempts text on an inactive control.',
};

/**
 * Tokens under their family's bar today, each with the item that owns the
 * repair. Every entry is a measured failure, not an exemption: the list only
 * shortens, and an entry that has been fixed fails its own test rather than
 * going quiet.
 */
export const UNDER_BAR: Record<string, string> = {};
