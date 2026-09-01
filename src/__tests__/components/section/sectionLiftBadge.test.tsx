import React from 'react';
import { render } from '@testing-library/react-native';
import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the detector flags a section whose ground is mostly a lift, the
 * flag survives every layer down to `isLift` on the FFI record, and no screen
 * draws it, so a section that looks wrong has nothing saying why.
 * Expected behaviour: a flagged section carries a badge in the detail header,
 * an unflagged one carries nothing, and the badge takes nothing away from the
 * name or its rename affordance.
 */

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));

// The barrel pulls react-native-iap in through useDonation, so it is replaced
// rather than spread: the header only needs the unit preference from it.
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
}));

const BASE: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportType: 'Ride',
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

function renderHeader(section: FrequentSection) {
  return render(
    <SectionHeader
      section={section}
      insetTop={0}
      activityColor="#000000"
      iconName="bike"
      activityCount={3}
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
      onBack={jest.fn()}
      onStartEditing={jest.fn()}
      onSaveName={jest.fn()}
      onCancelEdit={jest.fn()}
      onEditNameChange={jest.fn()}
    />
  );
}

describe('section lift badge', () => {
  it('badges a section the detector flagged as lift ground', () => {
    const tree = renderHeader({ ...BASE, isLift: true });

    expect(tree.getByTestId('section-lift-badge')).toBeTruthy();
  });

  it('shows nothing on a section that is not lift ground', () => {
    expect(renderHeader({ ...BASE, isLift: false }).queryByTestId('section-lift-badge')).toBeNull();
  });

  it('shows nothing when the flag never arrived', () => {
    expect(renderHeader(BASE).queryByTestId('section-lift-badge')).toBeNull();
  });

  it('leaves the name and its rename affordance alone', () => {
    const tree = renderHeader({ ...BASE, name: 'Top Station', isLift: true });

    expect(tree.getByText('Top Station')).toBeTruthy();
    expect(tree.getByTestId('section-rename-button')).toBeTruthy();
    expect(tree.getByTestId('section-lift-badge')).toBeTruthy();
  });
});
