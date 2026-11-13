/**
 * Scenario: the route grouping preview lists riding areas. An area whose
 * sections share a locality is named for it, and its count is routes there; the
 * section preview counts sections.
 *
 * Expected behaviour: the chip carries the locality when the engine gave one
 * and the letter otherwise, and the count follows the unit the screen asks for.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { PreviewCentrePicker } from '@/features/routes/components/preview/PreviewCentrePicker';
import { labelPreviewCentres } from '@/features/routes/lib/labelPreviewCentres';
import type { PreviewCentre } from 'veloqrs';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { ...jest.requireActual('expo-linear-gradient'), LinearGradient: View };
});

const NAMED: PreviewCentre = {
  binKey: 'named',
  lat: 1,
  lng: 2,
  visitTotal: 10,
  sectionCount: 26,
  routeCount: 4,
  name: 'Lakeside',
  source: 'sections',
};
const UNNAMED: PreviewCentre = { ...NAMED, binKey: 'unnamed', name: null, sectionCount: 1 };

function renderPicker(countBy?: 'routes') {
  const centres = [NAMED, UNNAMED];
  return render(
    <PreviewCentrePicker
      centres={centres}
      labels={labelPreviewCentres(centres)}
      selectedBinKey="named"
      onSelect={jest.fn()}
      {...(countBy ? { countBy } : {})}
    />
  );
}

describe('PreviewCentrePicker labels', () => {
  it('names an area by its locality and a nameless one by its letter', () => {
    const tree = renderPicker();
    expect(tree.getByTestId('preview-centre-named').props.accessibilityLabel).toContain('Lakeside');
    expect(tree.getByTestId('preview-centre-unnamed').props.accessibilityLabel).toContain(
      '"letter":"B"'
    );
  });

  it('counts sections by default and routes on the route grouping preview', () => {
    const sections = renderPicker();
    expect(sections.getByTestId('preview-centre-named').props.accessibilityLabel).toContain(
      'previewAreaSections:{"count":26}'
    );
    sections.unmount();

    const routes = renderPicker('routes');
    expect(routes.getByTestId('preview-centre-named').props.accessibilityLabel).toContain(
      'previewAreaRoutes:{"count":4}'
    );
  });
});
