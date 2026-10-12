import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionPRContent } from '@/features/insights/components/content/SectionPRContent';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values)}`,
  }),
}));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({ section: { id: 'rise', sportTypes: ['Ride'], activityPortions: [] } }),
}));
jest.mock('@/features/routes/hooks/useSectionPerformances', () => ({
  useSectionPerformances: () => ({
    records: [],
    bests: { forward: null, reverse: null, forwardIsPr: false, reverseIsPr: false },
    isLoading: false,
  }),
}));

it('shows the standing and previous best carried by the PR', async () => {
  const insight = {
    id: 'section',
    category: 'section_pr',
    supportingData: {
      sections: [
        {
          sectionId: 'rise',
          sectionName: 'Rise',
          bestTime: 300,
          sportType: 'Ride',
          standingCount: 4,
          percentileFaster: 75,
          previousBestTime: 310,
          previousBestDate: 1_700_000_000,
          deltaSeconds: 10,
        },
      ],
    },
  } as Insight;

  const { getByText } = await render(<SectionPRContent insight={insight} />);
  getByText('insights.sectionPrSheet.efforts:{"n":4}');
  getByText('insights.sectionPrSheet.fasterThan:{"percent":75}');
  getByText('insights.sectionPrSheet.fromPrevious:{"delta":"0:10"}');
  getByText(/insights.sectionPrSheet.previous:.+"time":"5:10"/);
});
