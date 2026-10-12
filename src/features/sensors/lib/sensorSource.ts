import type { KnownSensor, SensorKind } from '../types';

/**
 * `dedicated` is a value the sensor measures for that metric itself, `derived`
 * one it works out from something else: a power meter's crank revolutions
 * give cadence, but a speed and cadence sensor is built to measure it.
 */
export type SensorSourceOrigin = 'dedicated' | 'derived';

/** One stream of values for one metric: a sensor, and how it produces the value. */
export interface SensorSource {
  sensorId: string;
  origin: SensorSourceOrigin;
  /** When this source last delivered a value for the metric. */
  lastSampleAt: number;
}

export interface SensorSourceContext {
  /** The paired sensors in the order they were paired, carrying the athlete's choices. */
  knownSensors: KnownSensor[];
  now: number;
  /** A source silent for longer than this no longer counts as supplying the metric. */
  staleMs: number;
}

/** Two streams from one sensor are told apart by how they produce the value. */
export function sensorSourceKey(source: Pick<SensorSource, 'sensorId' | 'origin'>): string {
  return `${source.sensorId}:${source.origin}`;
}

/**
 * The one source a metric is recorded from, among those still sending.
 *
 * Two sensors feeding the same metric would otherwise interleave their values
 * into one recorded stream. So the sensor the athlete chose for the metric
 * wins, then a dedicated measurement over a derived one, then the sensor
 * paired first. A source that has gone quiet drops out, so the next one takes
 * over until it sends again. A sensor that is not paired, such as the demo
 * driver, ranks after every paired one.
 */
export function chooseSensorSource(
  kind: SensorKind,
  sources: readonly SensorSource[],
  { knownSensors, now, staleMs }: SensorSourceContext
): SensorSource | null {
  const pairedIndex = (sensorId: string) => {
    const index = knownSensors.findIndex((sensor) => sensor.id === sensorId);
    return index < 0 ? knownSensors.length : index;
  };
  const chosen = (sensorId: string) =>
    knownSensors.some((sensor) => sensor.id === sensorId && sensor.preferredFor?.includes(kind));

  let best: SensorSource | null = null;
  for (const source of sources) {
    if (now - source.lastSampleAt > staleMs) continue;
    if (best === null || outranks(source, best)) best = source;
  }
  return best;

  function outranks(a: SensorSource, b: SensorSource): boolean {
    const aChosen = chosen(a.sensorId);
    if (aChosen !== chosen(b.sensorId)) return aChosen;
    if (a.origin !== b.origin) return a.origin === 'dedicated';
    return pairedIndex(a.sensorId) < pairedIndex(b.sensorId);
  }
}

/**
 * The sensor a paired row names as the source of a metric: the one recording
 * it now, or, while nothing is sending, the one that would be chosen from
 * what each sensor advertises and what the athlete chose.
 */
export function displayedSensorSource(
  kind: SensorKind,
  knownSensors: KnownSensor[],
  activeSourceId: string | undefined
): string | null {
  if (activeSourceId !== undefined) return activeSourceId;
  const candidates = knownSensors
    .filter((sensor) => sensor.kinds.includes(kind) || sensor.preferredFor?.includes(kind))
    .map((sensor) => ({
      sensorId: sensor.id,
      origin: sensor.kinds.includes(kind) ? ('dedicated' as const) : ('derived' as const),
      lastSampleAt: 0,
    }));
  return (
    chooseSensorSource(kind, candidates, { knownSensors, now: 0, staleMs: 0 })?.sensorId ?? null
  );
}

const ALL_KINDS: SensorKind[] = ['heartRate', 'power', 'cadence'];

/**
 * The metrics a paired sensor supplies: what it advertises, what it has been
 * seen delivering, and what the athlete chose it for.
 */
export function metricsSuppliedBy(
  sensor: KnownSensor,
  supplied: readonly SensorKind[] | undefined
): SensorKind[] {
  const kinds = new Set([...sensor.kinds, ...(supplied ?? []), ...(sensor.preferredFor ?? [])]);
  return ALL_KINDS.filter((kind) => kinds.has(kind));
}
