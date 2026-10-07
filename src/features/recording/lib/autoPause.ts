export interface AutoPauseConfig {
  enabled: boolean;
  speedThreshold: number; // m/s
  durationThreshold: number; // ms below speed before triggering
}

const DEFAULT_DURATION_THRESHOLD = 5000;
// Resume requires clearly moving again (pause threshold × this factor), so
// GPS speed noise hovering around the threshold cannot flap pause/resume.
const RESUME_HYSTERESIS_FACTOR = 1.25;

export type AutoPauseDetector = ReturnType<typeof createAutoPauseDetector>;

/**
 * `paused` starts the detector in its own pause, for a ride it paused before a
 * restore, so the next fix above the resume speed resumes it.
 */
export function createAutoPauseDetector(
  config: AutoPauseConfig,
  { paused = false }: { paused?: boolean } = {}
): {
  update: (speed: number, timestamp: number) => 'pause' | 'resume' | null;
  /** The fix time the current stop began, so a pause starts there and not when it latched. */
  stoppedSince: () => number | null;
  reset: () => void;
} {
  let isPaused = paused;
  // Auto-pause cannot engage until a speed at or above the threshold has been
  // seen, so a rider still clipping in at the start is not paused.
  let hasMoved = paused;
  let belowThresholdSince: number | null = null;

  const threshold = config.durationThreshold ?? DEFAULT_DURATION_THRESHOLD;
  const resumeThreshold = config.speedThreshold * RESUME_HYSTERESIS_FACTOR;

  return {
    update(speed: number, timestamp: number): 'pause' | 'resume' | null {
      if (!config.enabled) return null;

      if (isPaused) {
        if (speed >= resumeThreshold) {
          isPaused = false;
          belowThresholdSince = null;
          return 'resume';
        }
        return null;
      }

      if (speed >= config.speedThreshold) hasMoved = true;

      if (!hasMoved) return null;

      if (speed < config.speedThreshold) {
        if (belowThresholdSince === null) {
          belowThresholdSince = timestamp;
        }
        if (timestamp - belowThresholdSince >= threshold) {
          isPaused = true;
          return 'pause';
        }
      } else {
        belowThresholdSince = null;
      }

      return null;
    },

    stoppedSince() {
      return belowThresholdSince;
    },

    reset() {
      isPaused = false;
      hasMoved = false;
      belowThresholdSince = null;
    },
  };
}
