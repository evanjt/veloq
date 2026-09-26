import { renderHook } from '@testing-library/react-native';

import { useFitnessComputations } from '@/features/fitness/hooks/useFitnessComputations';
import type { WellnessData } from '@/types';

const wellness = [
  { id: '2026-08-01', ctl: 40, atl: 35, rampRate: 1.5 },
  { id: '2026-08-02', ctl: 41, atl: 38, rampRate: 2.5 },
  { id: '2026-09-10', ctl: 55, atl: 50, rampRate: 6.2 },
] as WellnessData[];

function rampRateFor(selectedDate: string | null, rows: WellnessData[] = wellness) {
  const { result } = renderHook(() =>
    useFitnessComputations({
      wellness: rows,
      sportMode: 'Cycling',
      powerZones: undefined,
      hrZones: undefined,
      eftpHistory: undefined,
      decouplingStreams: undefined,
      selectedDate,
      selectedValues: selectedDate ? { fitness: 40, fatigue: 35, form: 5 } : null,
    })
  );
  return result.current;
}

describe('fitness header ramp rate', () => {
  it('follows the scrubbed or pinned day', () => {
    const r = rampRateFor('2026-08-01');
    expect(r.displayDate).toBe('2026-08-01');
    expect(r.rampRate).toBe(1.5);
  });

  it('is the newest day when nothing is selected', () => {
    expect(rampRateFor(null).rampRate).toBe(6.2);
  });

  it('is absent on a selected day with no wellness row', () => {
    expect(rampRateFor('2026-08-15').rampRate).toBeNull();
  });

  it('is absent on a selected day whose row carries none', () => {
    const rows = [{ id: '2026-08-01', ctl: 40, atl: 35 }, ...wellness.slice(1)] as WellnessData[];
    expect(rampRateFor('2026-08-01', rows).rampRate).toBeNull();
  });

  it('changes when the selection moves on the same wellness', () => {
    const { result, rerender } = renderHook(
      ({ selectedDate }: { selectedDate: string | null }) =>
        useFitnessComputations({
          wellness,
          sportMode: 'Cycling',
          powerZones: undefined,
          hrZones: undefined,
          eftpHistory: undefined,
          decouplingStreams: undefined,
          selectedDate,
          selectedValues: null,
        }),
      { initialProps: { selectedDate: '2026-08-01' as string | null } }
    );
    expect(result.current.rampRate).toBe(1.5);
    rerender({ selectedDate: '2026-08-02' });
    expect(result.current.rampRate).toBe(2.5);
    rerender({ selectedDate: null });
    expect(result.current.rampRate).toBe(6.2);
  });

  it('shows a pinned day its own loads when no chart has reported values', () => {
    const { result } = renderHook(() =>
      useFitnessComputations({
        wellness,
        sportMode: 'Cycling',
        powerZones: undefined,
        hrZones: undefined,
        eftpHistory: undefined,
        decouplingStreams: undefined,
        selectedDate: '2026-08-02',
        selectedValues: null,
      })
    );
    expect(result.current.displayDate).toBe('2026-08-02');
    expect(result.current.displayValues).toMatchObject({ fitness: 41, fatigue: 38, form: 3 });
    expect(result.current.formZone).not.toBeNull();
  });

  it('shows a pinned day with no wellness row no loads', () => {
    const { result } = renderHook(() =>
      useFitnessComputations({
        wellness,
        sportMode: 'Cycling',
        powerZones: undefined,
        hrZones: undefined,
        eftpHistory: undefined,
        decouplingStreams: undefined,
        selectedDate: '2026-08-15',
        selectedValues: null,
      })
    );
    expect(result.current.displayValues).toBeNull();
    expect(result.current.formZone).toBeNull();
  });
});
