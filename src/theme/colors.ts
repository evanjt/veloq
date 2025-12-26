export const colors = {
  primary: '#D4AF37',
  primaryDark: '#CC3D02',
  primaryLight: '#E8C96E',

  surface: '#FFFFFF',
  background: '#F5F5F5',

  textPrimary: '#1A1A1A',
  textSecondary: '#666666',
  textDisabled: '#9E9E9E',
  textOnDark: '#FFFFFF',      // White text for dark backgrounds
  textOnPrimary: '#FFFFFF',   // White text on primary color

  success: '#4CAF50',
  successLight: '#66BB6A',
  error: '#E53935',
  errorLight: '#EF5350',
  warning: '#F59E0B',
  warningLight: '#FBBF24',

  border: '#E0E0E0',
  divider: '#EEEEEE',

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
  surfaceOverlay: 'rgba(30, 30, 30, 0.95)',
  surfaceCard: 'rgba(50, 50, 50, 0.95)',
  textPrimary: '#FFFFFF',
  textSecondary: '#888888',
  textMuted: '#888888',
  border: '#333333',
  divider: '#333333',
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
