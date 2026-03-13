export interface AutoPauseConfig {
  enabled: boolean;
  speedThreshold: number; // m/s
  durationThreshold: number; // ms below speed before triggering
}

const DEFAULT_DURATION_THRESHOLD = 5000;

export function createAutoPauseDetector(config: AutoPauseConfig): {
  update: (speed: number, timestamp: number) => 'pause' | 'resume' | null;
  reset: () => void;
} {
  let isPaused = false;
  let belowThresholdSince: number | null = null;

  const threshold = config.durationThreshold ?? DEFAULT_DURATION_THRESHOLD;

  return {
    update(speed: number, timestamp: number): 'pause' | 'resume' | null {
      if (!config.enabled) return null;

      const belowSpeed = speed < config.speedThreshold;

      if (belowSpeed) {
        if (belowThresholdSince === null) {
          belowThresholdSince = timestamp;
        }
        if (!isPaused && timestamp - belowThresholdSince >= threshold) {
          isPaused = true;
          return 'pause';
        }
      } else {
        belowThresholdSince = null;
        if (isPaused) {
          isPaused = false;
          return 'resume';
        }
      }

      return null;
    },

    reset() {
      isPaused = false;
      belowThresholdSince = null;
    },
  };
}
