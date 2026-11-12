// The app's motion tokens name Reanimated easings; the page keeps the numbers only.
export const easingCurve = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0, 1],
  exit: [0.3, 0, 1, 1],
} as const;
export const duration = {
  instant: 0,
  fast: 120,
  standard: 200,
  slow: 320,
} as const;
export const easing = {
  standard: 'standard',
  enter: 'enter',
  exit: 'exit',
  linear: 'linear',
} as const;
export const transitions = {};
