import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SectionChooser } from '@/features/maps/components/regional/SectionChooser';
import type { MapSection } from '@/features/maps/hooks/useEngineMapActivities';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const sections: MapSection[] = [
  { id: 'ridge', name: 'Ridge Road', distanceMeters: 1200, visitCount: 2, polyline: [] },
  { id: 'canal', name: 'Canal Path', distanceMeters: 850, visitCount: 3, polyline: [] },
];

it('shows each section and selects the pressed row', () => {
  const onSelect = jest.fn();
  const view = render(
    <SectionChooser sections={sections} onSelect={onSelect} onClose={jest.fn()} />
  );
  expect(view.getByText('Ridge Road')).toBeTruthy();
  expect(view.getByText('Canal Path')).toBeTruthy();
  expect(view.getByText('1.2 km')).toBeTruthy();
  expect(view.getByText('850 m')).toBeTruthy();
  fireEvent.press(view.getByTestId('section-choice-canal'));
  expect(onSelect).toHaveBeenCalledWith('canal');
});
