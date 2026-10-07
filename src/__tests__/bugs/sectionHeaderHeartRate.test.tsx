/**
 * Scenario: laps carry heart rate only where a stream covered the traversal, so
 * a mean over them read as "Avg HR 163 (2/8)" in the section header.
 *
 * Expected behaviour: the header shows distance, traversals and terrain, and no
 * heart rate figure, whatever the section's laps carry.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));

jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
}));

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 8,
  createdAt: '2026-01-01T00:00:00Z',
};

// A caller still holding a heart rate summary must not get it on screen.
const legacyHeartRate = { avgHr: { bpm: 163, laps: 2, ofLaps: 8 } };

describe('the section header stats', () => {
  it('shows no heart rate figure or coverage', () => {
    const tree = render(
      <SectionHeader
        section={SECTION}
        insetTop={0}
        activityColor="#000000"
        iconName="bike"
        activityCount={8}
        mapReady={true}
        isTrimming={false}
        isExpandMode={false}
        trimStart={0}
        trimEnd={1}
        isEditing={false}
        editName=""
        customName={null}
        nameInputRef={React.createRef()}
        highlightedActivityId={null}
        onStartEditing={jest.fn()}
        onSaveName={jest.fn()}
        onCancelEdit={jest.fn()}
        onEditNameChange={jest.fn()}
        {...legacyHeartRate}
      />
    );

    expect(tree.queryByText(/163/)).toBeNull();
    expect(tree.queryByText(/sections\.avgHr/)).toBeNull();
    expect(tree.getByText(/8 sections\.traversals/)).toBeTruthy();
  });
});
