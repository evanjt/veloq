/**
 * Scenario: any app or web page can open `veloq://recording/<anything>`, and the
 * screen reads the sport and the paired event straight off the link.
 *
 * Expected behaviour: only a sport the recorder knows is accepted, a prototype
 * key never reads as a mode, and a paired event is a positive whole number.
 */
import type { ActivityType } from '@/types';
import {
  getRecordingMode,
  parsePairedEventId,
  parseRecordingType,
} from '@/features/recording/lib/recordingModes';

describe('getRecordingMode', () => {
  it('maps a known sport to its mode', () => {
    expect(getRecordingMode('Ride')).toBe('gps');
    expect(getRecordingMode('VirtualRide')).toBe('indoor');
    expect(getRecordingMode('Yoga')).toBe('manual');
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'reads the prototype key %s as manual rather than a function',
    (key) => {
      expect(getRecordingMode(key as ActivityType)).toBe('manual');
    }
  );
});

describe('parseRecordingType', () => {
  it('accepts a known sport', () => {
    expect(parseRecordingType('Ride')).toBe('Ride');
    expect(parseRecordingType('WeightTraining')).toBe('WeightTraining');
  });

  it.each(['Bogus', 'toString', 'constructor', '__proto__', '', 'ride'])('refuses %p', (raw) => {
    expect(parseRecordingType(raw)).toBeNull();
  });

  it('refuses a missing or repeated param', () => {
    expect(parseRecordingType(undefined)).toBeNull();
    expect(parseRecordingType(['Ride', 'Run'])).toBeNull();
  });
});

describe('parsePairedEventId', () => {
  it('accepts a positive whole number', () => {
    expect(parsePairedEventId('42')).toBe(42);
  });

  it.each(['abc', '0', '-3', '1.5', '', 'Infinity', '1e400', ' 7', '0x10'])('refuses %p', (raw) => {
    expect(parsePairedEventId(raw)).toBeUndefined();
  });

  it('refuses a missing or repeated param', () => {
    expect(parsePairedEventId(undefined)).toBeUndefined();
    expect(parsePairedEventId(['1', '2'])).toBeUndefined();
  });
});
