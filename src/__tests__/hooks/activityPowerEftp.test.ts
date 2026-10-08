import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { initialiseI18n } from '@/i18n';
import type { Activity } from '@/types';

describe('the activity power estimate', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('identifies the estimate as belonging to this activity and names its source', () => {
    const activity = {
      id: 'ride-1',
      type: 'Ride',
      icu_average_watts: 150,
      icu_pm_ftp_watts: 92,
      icu_ftp: 155,
    } as Activity;
    const { result } = renderHook(() => useActivityStats({ activity, isMetric: true, maxHR: 180 }));
    const card = result.current.stats.find((stat) => stat.title === 'Power');

    expect(card?.context).toMatch(/this activity.*92W/i);
    expect(card?.details).toContainEqual({
      label: expect.stringMatching(/this activity/i),
      value: '92W',
    });
    expect(card?.explanation).toMatch(/intervals\.icu.*power model.*this activity/i);
  });
});
