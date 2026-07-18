export interface AutoPauseConfig {
  enabled: boolean;
  speedThreshold: number; // m/s
  durationThreshold: number; // ms below speed before triggering
}

const DEFAULT_DURATION_THRESHOLD = 5000;
// Resume requires clearly moving again (pause threshold × this factor), so
// GPS speed noise hovering around the threshold cannot flap pause/resume.
const RESUME_HYSTERESIS_FACTOR = 1.25;

export function createAutoPauseDetector(config: AutoPauseConfig): {
  update: (speed: number, timestamp: number) => 'pause' | 'resume' | null;
  reset: () => void;
} {
  let isPaused = false;
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

    reset() {
      isPaused = false;
      belowThresholdSince = null;
    },
  };
}
