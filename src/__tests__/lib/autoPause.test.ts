import { createAutoPauseDetector, type AutoPauseConfig } from '@/lib/recording/autoPause';

describe('createAutoPauseDetector', () => {
  const defaultConfig: AutoPauseConfig = {
    enabled: true,
    speedThreshold: 1.0, // m/s
    durationThreshold: 5000, // 5s
  };

  describe('pause signal', () => {
    it('returns pause when speed below threshold for full duration', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // Below threshold but not long enough yet
      expect(detector.update(0.5, 0)).toBeNull();
      expect(detector.update(0.5, 2000)).toBeNull();
      expect(detector.update(0.5, 4999)).toBeNull();

      // Duration threshold reached
      expect(detector.update(0.5, 5000)).toBe('pause');
    });

    it('returns pause exactly at the duration threshold', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      detector.update(0.5, 1000); // belowThresholdSince = 1000
      expect(detector.update(0.5, 6000)).toBe('pause'); // 6000 - 1000 = 5000
    });
  });

  describe('resume signal', () => {
    it('returns resume when speed exceeds threshold after pause', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // Trigger pause
      detector.update(0.5, 0);
      expect(detector.update(0.5, 5000)).toBe('pause');

      // Speed above threshold
      expect(detector.update(2.0, 6000)).toBe('resume');
    });

    it('returns null after resume when speed stays above threshold', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // Trigger pause, then resume
      detector.update(0.5, 0);
      detector.update(0.5, 5000);
      detector.update(2.0, 6000);

      // Continued above threshold — no signal
      expect(detector.update(2.0, 7000)).toBeNull();
      expect(detector.update(3.0, 8000)).toBeNull();
    });
  });

  describe('debounce behavior', () => {
    it('does not pause if speed drops briefly then recovers', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // Speed drops below threshold
      expect(detector.update(0.5, 0)).toBeNull();
      expect(detector.update(0.5, 2000)).toBeNull();

      // Speed recovers before duration threshold
      expect(detector.update(3.0, 3000)).toBeNull();

      // Speed drops again — timer resets
      expect(detector.update(0.5, 4000)).toBeNull();
      expect(detector.update(0.5, 7000)).toBeNull();

      // Triggers after full duration from new drop
      expect(detector.update(0.5, 9000)).toBe('pause');
    });

    it('resets timer on every above-threshold sample', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // Alternating below/above keeps resetting the timer
      detector.update(0.5, 0);
      detector.update(0.5, 2000);
      detector.update(1.5, 3000); // above threshold — resets timer
      detector.update(0.5, 4000);
      detector.update(0.5, 6000);
      detector.update(1.5, 7000); // above threshold — resets timer
      detector.update(0.5, 8000);

      // Only 5000ms have passed since last above-threshold at 7000, so at 12000:
      // not yet at 8000 + 5000 = 13000
      expect(detector.update(0.5, 12000)).toBeNull();
      expect(detector.update(0.5, 13000)).toBe('pause');
    });
  });

  describe('configurable thresholds', () => {
    it('uses custom speed threshold', () => {
      const config: AutoPauseConfig = {
        enabled: true,
        speedThreshold: 2.0,
        durationThreshold: 3000,
      };
      const detector = createAutoPauseDetector(config);

      // 1.5 m/s is below 2.0 threshold
      expect(detector.update(1.5, 0)).toBeNull();
      expect(detector.update(1.5, 3000)).toBe('pause');
    });

    it('uses custom duration threshold', () => {
      const config: AutoPauseConfig = {
        enabled: true,
        speedThreshold: 1.0,
        durationThreshold: 10000,
      };
      const detector = createAutoPauseDetector(config);

      detector.update(0.5, 0);
      expect(detector.update(0.5, 5000)).toBeNull(); // Not enough time
      expect(detector.update(0.5, 9999)).toBeNull(); // Still not enough
      expect(detector.update(0.5, 10000)).toBe('pause');
    });
  });

  describe('disabled flag', () => {
    it('returns null regardless of speed when disabled', () => {
      const config: AutoPauseConfig = {
        enabled: false,
        speedThreshold: 1.0,
        durationThreshold: 5000,
      };
      const detector = createAutoPauseDetector(config);

      expect(detector.update(0, 0)).toBeNull();
      expect(detector.update(0, 10000)).toBeNull();
      expect(detector.update(0, 100000)).toBeNull();
    });

    it('never triggers resume when disabled', () => {
      const config: AutoPauseConfig = {
        enabled: false,
        speedThreshold: 1.0,
        durationThreshold: 5000,
      };
      const detector = createAutoPauseDetector(config);

      detector.update(0, 0);
      detector.update(0, 10000);
      expect(detector.update(5.0, 15000)).toBeNull();
    });
  });

  describe('zero speed', () => {
    it('treats zero as below threshold and triggers pause', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      expect(detector.update(0, 0)).toBeNull();
      expect(detector.update(0, 5000)).toBe('pause');
    });
  });

  describe('negative speed', () => {
    it('treats negative speed as below threshold', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      expect(detector.update(-1, 0)).toBeNull();
      expect(detector.update(-5, 5000)).toBe('pause');
    });
  });

  describe('reset()', () => {
    it('clears internal state allowing pause to trigger again', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // Trigger pause
      detector.update(0.5, 0);
      expect(detector.update(0.5, 5000)).toBe('pause');

      // Already paused — no repeat signal
      expect(detector.update(0.5, 6000)).toBeNull();

      // Reset
      detector.reset();

      // Can trigger pause again
      detector.update(0.5, 7000);
      expect(detector.update(0.5, 12000)).toBe('pause');
    });

    it('clears belowThresholdSince timer', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // Start accumulating below-threshold time
      detector.update(0.5, 0);
      detector.update(0.5, 3000); // 3s accumulated

      // Reset mid-accumulation
      detector.reset();

      // Timer should restart from scratch
      detector.update(0.5, 4000);
      expect(detector.update(0.5, 8000)).toBeNull(); // Only 4s since reset
      expect(detector.update(0.5, 9000)).toBe('pause'); // 5s since reset
    });
  });

  describe('only pauses once until resumed', () => {
    it('does not return pause repeatedly while speed stays low', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      detector.update(0.5, 0);
      expect(detector.update(0.5, 5000)).toBe('pause');

      // Already paused — should not return pause again
      expect(detector.update(0.5, 6000)).toBeNull();
      expect(detector.update(0.5, 10000)).toBeNull();
      expect(detector.update(0.5, 100000)).toBeNull();
    });

    it('can pause again after resume', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // First cycle: pause → resume
      detector.update(0.5, 0);
      expect(detector.update(0.5, 5000)).toBe('pause');
      expect(detector.update(2.0, 6000)).toBe('resume');

      // Second cycle: pause again
      detector.update(0.5, 7000);
      expect(detector.update(0.5, 12000)).toBe('pause');
    });
  });

  describe('speed exactly at threshold', () => {
    it('does not pause when speed equals threshold', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      // speed === threshold (1.0) is NOT below threshold
      expect(detector.update(1.0, 0)).toBeNull();
      expect(detector.update(1.0, 5000)).toBeNull();
      expect(detector.update(1.0, 10000)).toBeNull();
    });
  });

  describe('stress edge cases', () => {
    it('rapid oscillation does not produce false pause signal', () => {
      const detector = createAutoPauseDetector(defaultConfig);
      let result = null;

      for (let i = 0; i < 40; i++) {
        const speed = i % 2 === 0 ? 0.5 : 1.5; // alternate below/above
        const time = i * 100; // every 100ms
        result = detector.update(speed, time);
      }

      // 40 * 100ms = 4000ms total, but never 5000ms consecutive below threshold
      // because every other sample is above threshold, resetting the timer
      expect(result).toBeNull();
    });

    it('emits only one pause signal for extended stop', () => {
      const detector = createAutoPauseDetector(defaultConfig);

      const signals: string[] = [];
      // Simulate 1 hour at 0 speed, sampling every second
      for (let t = 0; t <= 3600000; t += 1000) {
        const signal = detector.update(0, t);
        if (signal) signals.push(signal);
      }

      // Should get exactly one pause signal
      expect(signals).toEqual(['pause']);
    });

    it('oscillation with period longer than threshold triggers pause', () => {
      const detector = createAutoPauseDetector(defaultConfig);
      const signals: string[] = [];

      // Below threshold for 6000ms (exceeds 5000ms threshold), then above
      for (let t = 0; t <= 6000; t += 1000) {
        const signal = detector.update(0.5, t);
        if (signal) signals.push(signal);
      }
      // Go above threshold
      const resumeSignal = detector.update(2.0, 7000);
      if (resumeSignal) signals.push(resumeSignal);

      expect(signals).toEqual(['pause', 'resume']);
    });

    it('many pause/resume cycles maintain correct state', () => {
      const detector = createAutoPauseDetector(defaultConfig);
      const signals: string[] = [];

      // Run 10 complete pause/resume cycles
      for (let cycle = 0; cycle < 10; cycle++) {
        const baseTime = cycle * 12000;
        // Below threshold for 6s → pause
        detector.update(0.5, baseTime);
        const pause = detector.update(0.5, baseTime + 6000);
        if (pause) signals.push(pause);
        // Above threshold → resume
        const resume = detector.update(2.0, baseTime + 7000);
        if (resume) signals.push(resume);
      }

      // Should have exactly 10 pause and 10 resume signals alternating
      expect(signals.length).toBe(20);
      expect(signals.filter((s) => s === 'pause').length).toBe(10);
      expect(signals.filter((s) => s === 'resume').length).toBe(10);
      // Verify strict alternation
      for (let i = 0; i < signals.length; i++) {
        expect(signals[i]).toBe(i % 2 === 0 ? 'pause' : 'resume');
      }
    });
  });
});
