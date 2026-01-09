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
  textMuted: '#71717A',
  textOnDark: '#FFFFFF',
  textOnPrimary: '#18181B', // Dark text on gold

  // Semantic
  success: '#22C55E',
  successLight: '#4ADE80',
  error: '#EF4444',
  errorLight: '#F87171',
  warning: '#F59E0B', // Amber, NOT orange
  warningLight: '#FBBF24',
  info: brand.blue,
  infoLight: brand.blueLight,

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

  // Activity type colors (NO ORANGE)
  ride: '#3B82F6', // Blue-500 - Royal blue for cycling
  run: '#10B981', // Emerald-500 - Fresh green
  swim: '#06B6D4', // Cyan-500 - Aqua/teal
  walk: '#8B5CF6', // Violet-500
  hike: '#A78BFA', // Violet-400
  workout: '#6366F1', // Indigo-500

  // Fitness metric colors
  fitness: brand.blue, // CTL - Brand blue
  fatigue: '#A855F7', // ATL - Purple (NOT orange)
  form: brand.blue, // TSB - Use blue (neutral), color should be zone-based at runtime

  // Chart accent colors
  chartBlue: brand.blue,
  chartPurple: '#A855F7',
  chartGreen: '#10B981',
  chartYellow: '#FBBF24',
  chartCyan: '#06B6D4',
  chartPink: '#EC4899',
  chartIndigo: '#6366F1',
  chartTeal: '#14B8A6',
  chartAmber: '#F59E0B',
  chartGold: brand.gold,
  chartRed: '#EF4444',

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
  formTransition: '#64B5F6', // Light blue - detraining risk
  formFresh: '#81C784', // Light green - ready for events
  formGreyZone: '#9E9E9E', // Grey - neutral zone
  formOptimal: '#66BB6A', // Green - peak training zone
  formHighRisk: '#EF5350', // Red - overtrained

  // Event priority colors
  eventPriorityA: '#EC4899', // Pink - priority race
  eventPriorityB: '#F59E0B', // Amber - secondary (NOT orange)
  eventPriorityC: '#71717A', // Gray - training

  // Workout step colors
  workoutWarmup: '#22C55E',
  workoutWork: brand.blue, // Blue for work intervals
  workoutRecovery: '#06B6D4',
  workoutCooldown: '#8B5CF6',
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
  textMuted: '#71717A',
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

  // Interactive states
  buttonSecondary: '#27272A',
  inputBackground: '#1F1F23',

  // Semantic overrides
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',

  // Chart colors for dark mode (optimized for visibility)
  chartFitness: brand.blueLight, // Brighter blue for CTL
  chartFatigue: '#C084FC', // Brighter purple for ATL
  chartForm: brand.blueLight, // Brighter blue for TSB (neutral, zone-based at runtime)
  chartPower: '#FBBF24', // Amber for power
  chartPace: '#4ADE80', // Green for pace
  chartHR: '#F87171', // Red for heart rate
  chartCadence: '#C084FC', // Purple for cadence
  chartElevation: '#94A3B8', // Slate for elevation
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
  form: [brand.blueLight, brand.blue] as const, // Blue gradient (neutral, zone-based at runtime)

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
  zone1: '#94A3B8', // Slate-400 - Recovery
  zone2: '#22C55E', // Green-500 - Endurance
  zone3: '#EAB308', // Yellow-500 - Tempo
  zone4: '#F59E0B', // Amber-500 - Threshold (NOT orange)
  zone5: '#EF4444', // Red-500 - VO2max
  zone6: '#A855F7', // Purple-500 - Anaerobic
  zone7: '#EC4899', // Pink-500 - Neuromuscular
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ColorKey = keyof typeof colors;
export type DarkColorKey = keyof typeof darkColors;
export type BrandColorKey = keyof typeof brand;
