/**
 * Scenario: the heart rate tile's number reads the live strap, and its tint
 * names a zone. The zone belongs to the engine, which classifies against the
 * athlete's own zones for the sport being recorded, the same ones the saved
 * activity's chart uses.
 *
 * Expected behaviour: the tint is the engine's zone for the sport and the live
 * bpm, whatever the recorded stream holds, and the screen is told only when
 * the zone it paints changes. The tile picks the colour for the scheme on
 * screen.
 */

import { renderHook } from '@testing-library/react-native';

import { useHrZoneColorEffect } from '@/features/recording/hooks/useHrZoneColorEffect';
import { engineHrZone } from '@/shared/native/hrZone';
import type { HrZoneInfo } from '@/features/recording/components/DataFieldGrid';

jest.mock('@/shared/native/hrZone', () => ({ engineHrZone: jest.fn() }));

const zonesOfTheAthlete = (_sport: string, bpm: number): number | null =>
  bpm <= 0 ? null : bpm < 140 ? 1 : bpm < 155 ? 2 : bpm < 170 ? 3 : bpm < 185 ? 4 : 5;

async function render(initialBpm: number, sport = 'Ride') {
  let zone: HrZoneInfo | null = null;
  const setHrZone = jest.fn((next: HrZoneInfo | null) => {
    zone = next;
  });
  const hook = await renderHook(
    ({ bpm }: { bpm: number }) => useHrZoneColorEffect(bpm, sport, setHrZone),
    { initialProps: { bpm: initialBpm } }
  );
  return { zone: () => zone, setHrZone, rerender: (bpm: number) => hook.rerender({ bpm }) };
}

beforeEach(() => {
  (engineHrZone as jest.Mock).mockReset().mockImplementation(zonesOfTheAthlete);
});

it('tints with the engine zone for the recorded sport and the live bpm', async () => {
  const { zone } = await render(150, 'Run');

  expect(engineHrZone).toHaveBeenCalledWith('Run', 150);
  expect(zone()).toEqual({ zone: 2 });
});

it('follows the live bpm across zones and drops the tint when it goes stale', async () => {
  const { zone, rerender } = await render(165);
  expect(zone()?.zone).toBe(3);

  await rerender(90);
  expect(zone()).toEqual({ zone: 1 });

  await rerender(0);
  expect(zone()).toBeNull();
});

it('does not tell the screen again while the zone holds', async () => {
  const { setHrZone, rerender } = await render(150);
  await rerender(152);
  await rerender(154);

  expect(setHrZone).toHaveBeenCalledTimes(1);
});

it('passes a zone past the ramp through, for the tile to clamp', async () => {
  (engineHrZone as jest.Mock).mockReturnValue(9);
  const { zone } = await render(150);

  expect(zone()).toEqual({ zone: 9 });
});

it('shows no tint while the engine has no answer', async () => {
  (engineHrZone as jest.Mock).mockReturnValue(null);
  const { zone } = await render(150);

  expect(zone()).toBeNull();
});
