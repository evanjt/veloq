/**
 * Scenario: intervals.icu marks an activity that changed the accepted eFTP.
 * The markers used to be derived here, from the parsed body of every activity
 * in the window; the sync now stores them and the engine answers with them.
 *
 * Expected behaviour: the hook maps the engine's records onto the local day
 * the plot keys on, and the label reads the same as it did.
 */

import { renderHook } from '@testing-library/react-native';

import {
  eftpChangesOn,
  formatEftpChange,
  type EftpChange,
} from '@/features/fitness/lib/eftpChanges';
import { useEftpChanges } from '@/features/fitness/hooks/useEftpChanges';

const mockGetEftpChanges = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getEftpChanges: mockGetEftpChanges }),
}));

jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineSubscription: () => 0,
  // The hook reads through the keyed reader, so the stub is the reader and not
  // the counter: it hands the closure whatever `getEngine` answers.
  useEngineRead:
    () =>
    <T>(read: (engine: unknown) => T): T | undefined => {
      const engine = jest.requireMock('@/shared/native/engine').getEngine();
      return engine ? read(engine) : undefined;
    },
}));

/** Local midnight, so the mapped day is the one the record was dated by. */
function localNoon(day: string): number {
  return new Date(`${day}T12:00:00`).getTime() / 1000;
}

const change = (over: Partial<EftpChange> & { day: string }) => ({
  activityId: over.activityId ?? 'a',
  date: localNoon(over.day),
  eftp: over.eftp ?? 406,
  delta: over.delta ?? 20,
  activityName: over.activityName ?? 'Ride',
});

describe('useEftpChanges', () => {
  beforeEach(() => mockGetEftpChanges.mockReset());

  it('dates each marker by the local day the plot keys on', () => {
    mockGetEftpChanges.mockReturnValue([
      change({ day: '2026-06-06', activityId: 'a', eftp: 390, delta: 33 }),
      change({ day: '2026-07-14', activityId: 'b', eftp: 406, delta: 20 }),
    ]);

    const { result } = renderHook(() => useEftpChanges());

    expect(result.current.map((c) => [c.activityId, c.date, c.eftp, c.delta])).toEqual([
      ['a', '2026-06-06', 390, 33],
      ['b', '2026-07-14', 406, 20],
    ]);
  });

  it('answers with nothing when the engine is not up', () => {
    mockGetEftpChanges.mockImplementation(() => {
      throw new Error('engine closed');
    });

    const { result } = renderHook(() => useEftpChanges());

    expect(result.current).toEqual([]);
  });
});

describe('the markers on one day', () => {
  const markers: EftpChange[] = [
    { date: '2026-07-14', eftp: 406, delta: 20, activityId: 'a', activityName: 'Ride' },
    { date: '2026-07-14', eftp: 410, delta: 4, activityId: 'b', activityName: 'Ride' },
    { date: '2026-08-30', eftp: 155, delta: -12.6, activityId: 'c', activityName: 'Ride' },
  ];

  it('answers a day with its changes and a day without with none', () => {
    expect(eftpChangesOn(markers, '2026-07-14').map((c) => c.activityId)).toEqual(['a', 'b']);
    expect(eftpChangesOn(markers, '2026-07-15')).toEqual([]);
    expect(eftpChangesOn(markers, undefined)).toEqual([]);
  });

  it('formats a rise with its plus and a fall with its minus', () => {
    expect(formatEftpChange({ ...markers[0], eftp: 406.4 })).toBe('eFTP 406 W (+20)');
    expect(formatEftpChange(markers[2])).toBe('eFTP 155 W (-13)');
  });
});
