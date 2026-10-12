import {
  chooseSensorSource,
  displayedSensorSource,
  type SensorSource,
} from '@/features/sensors/lib/sensorSource';
import { useSensorStore } from '@/features/sensors/store';
import type { KnownSensor } from '@/features/sensors/types';
import { getSetting, setSetting } from '@/shared/storage';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => undefined),
  removeSetting: jest.fn(async () => undefined),
}));

const METER: KnownSensor = { id: 'meter', name: 'Meter', kinds: ['power'] };
const POD: KnownSensor = { id: 'pod', name: 'Pod', kinds: ['cadence'] };
const STRAP_A: KnownSensor = { id: 'strap-a', name: 'Strap A', kinds: ['heartRate'] };
const STRAP_B: KnownSensor = { id: 'strap-b', name: 'Strap B', kinds: ['heartRate'] };

const NOW = 100_000;
const STALE_MS = 5000;
const context = (knownSensors: KnownSensor[]) => ({ knownSensors, now: NOW, staleMs: STALE_MS });
const source = (
  sensorId: string,
  origin: SensorSource['origin'] = 'dedicated',
  lastSampleAt = NOW
): SensorSource => ({ sensorId, origin, lastSampleAt });

describe('chooseSensorSource', () => {
  it('has no source when nothing has sent', () => {
    expect(chooseSensorSource('cadence', [], context([METER, POD]))).toBeNull();
  });

  it('picks a dedicated cadence sensor over crank cadence, whatever the pairing order', () => {
    const sources = [source('meter', 'derived'), source('pod')];
    expect(chooseSensorSource('cadence', sources, context([METER, POD]))?.sensorId).toBe('pod');
    expect(chooseSensorSource('cadence', sources, context([POD, METER]))?.sensorId).toBe('pod');
  });

  it('picks the sensor paired first between two of a kind', () => {
    const sources = [source('strap-b'), source('strap-a')];
    expect(chooseSensorSource('heartRate', sources, context([STRAP_A, STRAP_B]))?.sensorId).toBe(
      'strap-a'
    );
  });

  it("puts the athlete's choice above a dedicated sensor", () => {
    const sources = [source('meter', 'derived'), source('pod')];
    const chosen = chooseSensorSource(
      'cadence',
      sources,
      context([{ ...METER, preferredFor: ['cadence'] }, POD])
    );
    expect(chosen?.sensorId).toBe('meter');
  });

  it('holds a choice to the metric it was made for', () => {
    const sources = [source('strap-a'), source('strap-b')];
    const chosen = chooseSensorSource(
      'heartRate',
      sources,
      context([STRAP_A, { ...STRAP_B, preferredFor: ['cadence'] }])
    );
    expect(chosen?.sensorId).toBe('strap-a');
  });

  it('passes over a source silent past the stale window, and keeps one exactly at it', () => {
    const known = context([STRAP_A, STRAP_B]);
    const atEdge = [source('strap-a', 'dedicated', NOW - STALE_MS), source('strap-b')];
    expect(chooseSensorSource('heartRate', atEdge, known)?.sensorId).toBe('strap-a');

    const past = [source('strap-a', 'dedicated', NOW - STALE_MS - 1), source('strap-b')];
    expect(chooseSensorSource('heartRate', past, known)?.sensorId).toBe('strap-b');
  });

  it("falls back from the athlete's choice when it goes quiet", () => {
    const sources = [source('meter', 'derived', NOW - STALE_MS - 1), source('pod')];
    const chosen = chooseSensorSource(
      'cadence',
      sources,
      context([{ ...METER, preferredFor: ['cadence'] }, POD])
    );
    expect(chosen?.sensorId).toBe('pod');
  });

  it('has no source when every one has gone quiet', () => {
    const sources = [source('strap-a', 'dedicated', 0), source('strap-b', 'dedicated', 0)];
    expect(chooseSensorSource('heartRate', sources, context([STRAP_A, STRAP_B]))).toBeNull();
  });

  it('ranks a sensor that is not paired after every paired one', () => {
    const sources = [source('demo'), source('strap-b')];
    expect(chooseSensorSource('heartRate', sources, context([STRAP_B]))?.sensorId).toBe('strap-b');
    expect(chooseSensorSource('heartRate', [source('demo')], context([]))?.sensorId).toBe('demo');
  });

  it("prefers one sensor's dedicated stream over its own derived one", () => {
    const both = { id: 'both', name: 'Both', kinds: ['power', 'cadence'] } as KnownSensor;
    const sources = [source('both', 'derived'), source('both', 'dedicated')];
    expect(chooseSensorSource('cadence', sources, context([both]))?.origin).toBe('dedicated');
  });
});

describe('displayedSensorSource', () => {
  it('names the live source when there is one', () => {
    expect(displayedSensorSource('heartRate', [STRAP_A, STRAP_B], 'strap-b')).toBe('strap-b');
  });

  it('names the sensor that would be chosen while nothing sends', () => {
    expect(displayedSensorSource('heartRate', [STRAP_A, STRAP_B], undefined)).toBe('strap-a');
    expect(
      displayedSensorSource(
        'heartRate',
        [STRAP_A, { ...STRAP_B, preferredFor: ['heartRate'] }],
        undefined
      )
    ).toBe('strap-b');
    expect(displayedSensorSource('power', [STRAP_A], undefined)).toBeNull();
  });
});

describe('the athlete choosing a source', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSensorStore.setState({ knownSensors: [STRAP_A, STRAP_B, METER] });
  });

  it('moves the choice from one sensor to another and persists it with the paired sensors', () => {
    const { setPreferredSource } = useSensorStore.getState();
    setPreferredSource('strap-b', 'heartRate');
    setPreferredSource('strap-a', 'heartRate');

    const expected = [{ ...STRAP_A, preferredFor: ['heartRate'] }, STRAP_B, METER];
    expect(useSensorStore.getState().knownSensors).toEqual(expected);
    expect(setSetting).toHaveBeenLastCalledWith('veloq-known-sensors', JSON.stringify(expected));
  });

  it('keeps a choice made for another metric', () => {
    const { setPreferredSource } = useSensorStore.getState();
    setPreferredSource('meter', 'cadence');
    setPreferredSource('meter', 'power');
    setPreferredSource('strap-a', 'heartRate');

    const meter = useSensorStore.getState().knownSensors.find((s) => s.id === 'meter');
    expect(meter?.preferredFor).toEqual(['cadence', 'power']);
  });

  it('reads the choice back from a stored list, and a list written before choices existed', async () => {
    (getSetting as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([STRAP_A, { ...STRAP_B, preferredFor: ['heartRate'] }])
    );
    await useSensorStore.getState().initialise();
    expect(
      displayedSensorSource('heartRate', useSensorStore.getState().knownSensors, undefined)
    ).toBe('strap-b');

    (getSetting as jest.Mock).mockResolvedValueOnce(JSON.stringify([STRAP_A, STRAP_B]));
    await useSensorStore.getState().initialise();
    expect(
      displayedSensorSource('heartRate', useSensorStore.getState().knownSensors, undefined)
    ).toBe('strap-a');
  });
});
