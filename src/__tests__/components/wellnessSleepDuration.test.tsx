import React from 'react';
import { render } from '@testing-library/react-native';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, values?: { hours: number; minutes: number }) =>
      key === 'wellness.sleepDuration' && values ? `${values.hours}h ${values.minutes}m` : key,
  }),
}));

const DAYS: WellnessData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `2026-06-${String(i + 1).padStart(2, '0')}`,
  sleepSecs: 28_770,
}));

describe('wellness sleep duration', () => {
  it('carries rounded minutes into the hour', async () => {
    const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    expect(tree.getByText('8h 0m')).toBeTruthy();
    expect(tree.getByText('sections.avg 8h 0m')).toBeTruthy();
    expect(tree.queryByText('7h 60m')).toBeNull();
  });
});
