/**
 * Scenario: the section detail read says whether the athlete may ask for the
 * section to be named from its places, which it says only while geocoding is
 * on and the section has no typed name.
 *
 * Expected behaviour: the header draws the button beside the name exactly when
 * the read allows it and the name is not being edited or the bounds trimmed,
 * and a press asks for this section.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import { createMapHighlightStore } from '@/features/routes/lib/mapHighlight';
import type { FrequentSection } from '@/types';
import { PlaceNameKind, PlaceNameOutcome } from '../../__shared__/veloqrsStub';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

const mockNameFromPlaces = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ nameFromPlaces: mockNameFromPlaces }),
}));

const SECTION: FrequentSection = {
  id: 'sec-7',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
  name: 'Section 7',
};

function renderHeader(canNameFromPlaces: boolean, isTrimming = false) {
  return render(
    <SectionHeader
      section={SECTION}
      insetTop={0}
      activityColor="#000000"
      iconName="bike"
      activityCount={3}
      mapReady={true}
      isTrimming={isTrimming}
      isExpandMode={false}
      trimStart={0}
      trimEnd={1}
      customName={null}
      highlight={createMapHighlightStore()}
      canNameFromPlaces={canNameFromPlaces}
      onSaveName={jest.fn()}
    />
  );
}

beforeEach(() => {
  mockNameFromPlaces.mockReset();
  mockNameFromPlaces.mockResolvedValue(PlaceNameOutcome.Named);
});

it('offers the place name button when the read allows it', async () => {
  expect((await renderHeader(true)).getByTestId('section-place-name-button')).toBeTruthy();
});

it('draws no place name button when the read refuses it', async () => {
  expect((await renderHeader(false)).queryByTestId('section-place-name-button')).toBeNull();
});

it('draws no place name button while the bounds are trimmed', async () => {
  expect((await renderHeader(true, true)).queryByTestId('section-place-name-button')).toBeNull();
});

it('hides the button while the name is being edited', async () => {
  const tree = await renderHeader(true);

  await fireEvent.press(tree.getByTestId('section-rename-button'));

  expect(tree.queryByTestId('section-place-name-button')).toBeNull();
});

it('asks for this section when pressed', async () => {
  const tree = await renderHeader(true);

  await fireEvent.press(tree.getByTestId('section-place-name-button'));

  expect(mockNameFromPlaces).toHaveBeenCalledWith(PlaceNameKind.Section, 'sec-7');
});
