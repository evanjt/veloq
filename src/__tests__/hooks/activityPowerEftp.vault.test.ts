import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { initialiseI18n } from '@/i18n';

import { activityRecord } from '../__shared__/activityRecord';

describe('the activity power estimate', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('identifies the estimate as belonging to this activity and names its source', async () => {
    const activity = activityRecord({
      id: 'ride-1',
      sportType: 'Ride',
      avgPower: 150,
      eftp: 92,
      ftp: 155,
    });
    const { result } = await renderHook(() =>
      useActivityStats({ activity, isMetric: true, maxHR: 180 })
    );
    const card = result.current.stats.find((stat) => stat.title === 'Power');

    expect(card?.context).toMatch(/this activity.*92 W/i);
    expect(card?.details).toContainEqual({
      label: expect.stringMatching(/this activity/i),
      value: '92 W',
    });
    expect(card?.explanation).toMatch(/intervals\.icu.*power model.*this activity/i);
  });
});
