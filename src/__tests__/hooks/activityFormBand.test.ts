/**
 * Scenario: one athlete, one day, one TSB, shown on the fitness tab and on the
 * activity card.
 * Expected behaviour: both surfaces colour the number from the same five-band
 * ladder, `getFormZone` and `FORM_ZONE_COLORS`, on every band and at every
 * boundary, and a card with no wellness shows no form stat at all.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { getFormZone, FORM_ZONE_COLORS } from '@/features/fitness/lib/fitness';
import type { Activity, WellnessData } from '@/types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const activity = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
} as Activity;

function formStat(wellness?: WellnessData) {
  const { result } = renderHook(() => useActivityStats({ activity, wellness }));
  return result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
}

describe('the activity card form band', () => {
  it.each([-35, -30, -20, -10, -5, 0, 5, 10, 25, 30])(
    'colours a TSB of %d from the fitness ladder',
    (tsb) => {
      const stat = formStat({ ctl: 50, atl: 50 - tsb } as WellnessData);
      expect(stat).toBeDefined();
      expect(stat?.color).toBe(FORM_ZONE_COLORS[getFormZone(tsb)]);
    }
  );

  it('shows no form stat without wellness', () => {
    expect(formStat(undefined)).toBeUndefined();
    expect(formStat({ ctl: 50 } as WellnessData)).toBeUndefined();
  });
});
