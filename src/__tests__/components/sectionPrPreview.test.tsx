/**
 * Scenario: the PR card names a section and draws nothing of it, so an athlete
 * reading a record on "section 6" cannot tell which stretch of road that is
 * without leaving the card.
 *
 * Expected behaviour: the row draws the section's line beside the name when
 * the engine handed one over, and leaves the row as it was when it did not.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import type { InsightSupportingData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

/** A short line, enough for a start and a finish marker. */
const LINE = [
  { lat: 46.2, lng: 7.35 },
  { lat: 46.21, lng: 7.36 },
  { lat: 46.22, lng: 7.38 },
];

function sectionData(previewPoints?: { lat: number; lng: number }[]): InsightSupportingData {
  return {
    sections: [
      {
        sectionId: 'auto1',
        sectionName: 'Section 6',
        bestTime: 190,
        previewPoints,
      },
    ],
  };
}

describe('the PR card section row', () => {
  it('draws the section the record was set on', () => {
    const { getByTestId } = render(<SupportingDataSection data={sectionData(LINE)} />);
    expect(getByTestId('section-preview-auto1')).toBeTruthy();
  });

  it('draws nothing when the engine handed over no line', () => {
    const { queryByTestId } = render(<SupportingDataSection data={sectionData()} />);
    expect(queryByTestId('section-preview-auto1')).toBeNull();
  });

  it('draws nothing for a line too short to have two ends', () => {
    const { queryByTestId } = render(
      <SupportingDataSection data={sectionData([{ lat: 46.2, lng: 7.35 }])} />
    );
    expect(queryByTestId('section-preview-auto1')).toBeNull();
  });
});
