/**
 * Creates a color with opacity from a hex color
 * @param hex - The hex color (e.g., '#D4AF37' or 'FBBF24')
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

export const colors = {
  primary: '#D4AF37',
  primaryDark: '#CC3D02',
  primaryLight: '#E8C96E',

  surface: '#FFFFFF',
  background: '#F5F5F5',

  textPrimary: '#1A1A1A',
  textSecondary: '#666666',
  textDisabled: '#9E9E9E',
  textMuted: '#888888',
  textOnDark: '#FFFFFF',      // White text for dark backgrounds
  textOnPrimary: '#FFFFFF',   // White text on primary color

  success: '#4CAF50',
  successLight: '#66BB6A',
  error: '#E53935',
  errorLight: '#EF5350',
  warning: '#F59E0B',
  warningLight: '#FBBF24',
  info: '#2196F3',
  infoLight: '#64B5F6',

  border: '#E0E0E0',
  borderLight: '#EEEEEE',
  divider: '#EEEEEE',

  // Neutral grays (light mode)
  gray50: '#FAFAFA',
  gray100: '#F5F5F5',
  gray200: '#EEEEEE',
  gray300: '#E0E0E0',
  gray400: '#BDBDBD',
  gray500: '#9E9E9E',
  gray600: '#757575',
  gray700: '#616161',
  gray800: '#424242',
  gray900: '#212121',

  // Activity type colors
  ride: '#5B9BD5',
  run: '#4CAF50',
  swim: '#2196F3',
  walk: '#9C27B0',
  hike: '#795548',
  workout: '#607D8B',

  // Fitness metric colors
  fitness: '#42A5F5',  // CTL - blue
  fatigue: '#A855F7',  // ATL - orange
  form: '#66BB6A',     // TSB - green

  // Chart accent colors
  chartBlue: '#2196F3',
  chartOrange: '#5B9BD5',
  chartGreen: '#4CAF50',
  chartPurple: '#9C27B0',
  chartYellow: '#FFB300',
  chartCyan: '#00BCD4',
  chartPink: '#E91E63',
  chartIndigo: '#3F51B5',
  chartTeal: '#009688',
  chartAmber: '#FFC107',
  chartGold: '#FFB300',

  // Semantic UI colors
  highlight: '#00BCD4',        // Cyan for highlighted items
  highlightAlt: '#03A9F4',     // Light blue alternative
  shadowBlack: '#000000',      // For shadows
  transparent: 'transparent',

  // Direction indicator colors
  sameDirection: '#2196F3',    // Blue for same direction
  reverseDirection: '#E91E63', // Pink for reverse
  consensusRoute: '#F59E0B',   // Orange for consensus/main route

  // Form zone colors
  formTransition: '#64B5F6',   // Blue - transition
  formFresh: '#81C784',        // Light green - fresh
  formGreyZone: '#9E9E9E',     // Grey - grey zone
  formOptimal: '#66BB6A',      // Green - optimal
  formHighRisk: '#EF5350',     // Red - high risk

  // Event priority colors
  eventPriorityA: '#E91E63',   // Pink - priority race
  eventPriorityB: '#F59E0B',   // Orange - secondary
  eventPriorityC: '#9E9E9E',   // Gray - training

  // Workout step colors
  workoutWarmup: '#4CAF50',
  workoutWork: '#5B9BD5',
  workoutRecovery: '#2196F3',
  workoutCooldown: '#9C27B0',
} as const;

// Gradient presets for cards and backgrounds
export const gradients = {
  primary: ['#E8C96E', '#D4AF37'] as const,
  primarySoft: ['#FF8F4C', '#E8C96E'] as const,
  sunset: ['#E8C96E', '#FF8F4C', '#FBBF24'] as const,
  ocean: ['#0099FF', '#42A5F5', '#00BCD4'] as const,
  fitness: ['#64B5F6', '#42A5F5'] as const,
  fatigue: ['#FF8A65', '#A855F7'] as const,
  form: ['#81C784', '#66BB6A'] as const,
  success: ['#81C784', '#66BB6A'] as const,
  warning: ['#FBBF24', '#F59E0B'] as const,
  purple: ['#BA68C8', '#9C27B0'] as const,
  dark: ['rgba(40,40,40,0.95)', 'rgba(25,25,25,0.98)'] as const,
  light: ['rgba(255,255,255,0.98)', 'rgba(250,250,250,0.95)'] as const,
  glass: ['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.05)'] as const,
  glassDark: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.02)'] as const,
} as const;

// Glow/shadow colors for emphasis
export const glows = {
  primary: 'rgba(252, 76, 2, 0.4)',
  success: 'rgba(76, 175, 80, 0.4)',
  warning: 'rgba(255, 152, 0, 0.4)',
  error: 'rgba(229, 57, 53, 0.4)',
  blue: 'rgba(33, 150, 243, 0.4)',
  purple: 'rgba(156, 39, 176, 0.4)',
} as const;

export type ColorKey = keyof typeof colors;

// Dark mode specific colors
export const darkColors = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceElevated: '#252525',
  surfaceCard: '#2A2A2A',
  surfaceOverlay: 'rgba(30, 30, 30, 0.95)',
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textMuted: '#888888',
  textDisabled: '#666666',
  border: '#333333',
  borderLight: '#444444',
  divider: '#333333',

  // Icon colors for dark mode
  iconPrimary: '#FFFFFF',
  iconSecondary: '#888888',
  iconMuted: '#666666',
  iconDisabled: '#555555',

  // Interactive states
  buttonSecondary: '#333333',
  inputBackground: '#2A2A2A',

  // Semantic overrides for dark mode
  success: '#66BB6A',
  warning: '#FBBF24',
  error: '#EF5350',

  // Chart colors for dark mode (slightly brighter for visibility)
  chartFitness: '#64B5F6',   // Brighter blue for CTL
  chartFatigue: '#FF8A65',   // Brighter orange for ATL
  chartForm: '#81C784',      // Brighter green for TSB
  chartPower: '#FBBF24',     // Amber for power
  chartPace: '#66BB6A',      // Green for pace
  chartHR: '#EF5350',        // Red for heart rate
  chartCadence: '#BA68C8',   // Purple for cadence
  chartElevation: '#90A4AE', // Blue-grey for elevation
} as const;

export type DarkColorKey = keyof typeof darkColors;

// Opacity scale for overlays and backgrounds
export const opacity = {
  // Light mode overlays (black with opacity)
  overlay: {
    subtle: 'rgba(0, 0, 0, 0.03)',    // Barely visible tint
    light: 'rgba(0, 0, 0, 0.05)',     // Divider lines
    medium: 'rgba(0, 0, 0, 0.1)',     // Disabled states
    heavy: 'rgba(0, 0, 0, 0.5)',      // Modal backdrops
    full: 'rgba(0, 0, 0, 0.65)',      // Map stat pills
  },
  // Dark mode overlays (white with opacity)
  overlayDark: {
    subtle: 'rgba(255, 255, 255, 0.03)',
    light: 'rgba(255, 255, 255, 0.05)',
    medium: 'rgba(255, 255, 255, 0.1)',
    heavy: 'rgba(255, 255, 255, 0.15)',
  },
} as const;
