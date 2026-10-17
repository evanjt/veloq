import { Easing, FadeIn, FadeOut, SlideInUp, SlideOutUp } from 'react-native-reanimated';

/**
 * How long things move, in milliseconds. The style guide's nine durations:
 * an exit is never longer than the entry it closes, a loop that shows no
 * progress stops after three cycles, and status text holds for `hold` and
 * changes with a `message` cross-fade.
 */
export const duration = {
  instant: 100,
  quick: 150,
  exit: 200,
  standard: 250,
  slow: 300,
  message: 600,
  pulse: 800,
  hold: 1500,
  loop: 2400,
} as const;

export type MotionDuration = keyof typeof duration;

/**
 * The cubic bezier control points behind each easing. Standard is for
 * anything moving on screen, enter for something arriving, exit for something
 * leaving. Linear is for loops and progress only.
 */
export const easingCurve = {
  standard: [0.4, 0, 0.2, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
  linear: [0, 0, 1, 1],
} as const;

/** Reanimated easings for the four curves. */
export const easing = {
  standard: Easing.bezier(...easingCurve.standard),
  enter: Easing.bezier(...easingCurve.enter),
  exit: Easing.bezier(...easingCurve.exit),
  linear: Easing.linear,
};

/** The paired durations, for an animation driven by hand rather than by a preset. */
export const motionPairs = {
  /** A banner in the top slot. */
  banner: { enter: duration.standard, exit: duration.exit },
  /** A floating pill. */
  pill: { enter: duration.exit, exit: duration.quick },
  /** A card arriving in a feed. */
  card: { enter: duration.slow, exit: duration.exit },
} as const;

/**
 * Layout animations for each pair. Every banner, pill and card takes these
 * objects rather than building its own, so they enter and leave alike.
 */
export const motionPresets = {
  banner: {
    entering: SlideInUp.duration(motionPairs.banner.enter).easing(easing.enter),
    exiting: SlideOutUp.duration(motionPairs.banner.exit).easing(easing.exit),
  },
  pill: {
    entering: FadeIn.duration(motionPairs.pill.enter),
    exiting: FadeOut.duration(motionPairs.pill.exit),
  },
  card: {
    entering: FadeIn.duration(motionPairs.card.enter),
    exiting: FadeOut.duration(motionPairs.card.exit),
  },
};

/**
 * Map camera moves. The style guide has no rung for them yet, so each is
 * named here rather than typed at the call. Under reduce motion they jump.
 */
export const cameraMove = {
  /** Zooming into a cluster of few activities. */
  short: 300,
  /** Fanning out a cluster, or framing a preview area. */
  brisk: 400,
  /** Framing a region or a section, following a position, or turning north up. */
  move: 500,
  /** Framing a whole route in 3D, or zooming into a large cluster. */
  long: 600,
} as const;
