import { useSensorStore } from '../store';

/**
 * Demo-mode sensor driver: feeds plausible heart rate, power, and cadence
 * values into the sensor store at 1 Hz so recording can be exercised (and
 * E2E-tested) without hardware.
 */

const SIMULATED_ID = 'simulated-sensors';

let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

export function startSimulatedSensors(): void {
  if (timer) return;
  const store = useSensorStore.getState();
  store.setConnection(SIMULATED_ID, {
    status: 'connected',
    name: 'Demo sensors',
    kinds: ['heartRate', 'power', 'cadence'],
    batteryPercent: 82,
  });

  timer = setInterval(() => {
    tick += 1;
    const s = useSensorStore.getState();
    // Slow sinusoidal drift + small jitter, deterministic enough for tests
    const wave = Math.sin(tick / 30);
    s.setLatest('heartRate', Math.round(140 + 15 * wave + (tick % 3)));
    s.setLatest('power', Math.round(190 + 40 * wave + ((tick * 7) % 11)));
    s.setLatest('cadence', Math.round(87 + 4 * wave));
  }, 1000);
}

export function stopSimulatedSensors(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  tick = 0;
  const store = useSensorStore.getState();
  store.setConnection(SIMULATED_ID, null);
  store.clearLatest();
}

export function isSimulatedSensorsRunning(): boolean {
  return timer !== null;
}
