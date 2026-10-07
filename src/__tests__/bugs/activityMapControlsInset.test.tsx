/**
 * Scenario: the activity hero's map starts at y = 0 and runs under the status bar, and the
 * transparent native header (inset plus the back button row) is drawn over it and takes the touches
 * there. A control column placed a fixed distance from the map's top lands under that header on a
 * handset with a status bar, so the style button cannot be pressed.
 *
 * Expected behaviour: the column starts below the inset and the header row.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ActivityMapControls } from '@/features/maps/components/ActivityMapControls';
import { HERO_HEADER_HEIGHT } from '@/shared/ui';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const INSET_TOP = 44;
const METRICS = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: INSET_TOP, left: 0, right: 0, bottom: 0 },
};

function renderControls() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapControls
        isDark={false}
        mapStyle="satellite"
        onToggleStyle={jest.fn()}
        hasGradientData={false}
        gradientActive={false}
        onToggleGradient={jest.fn()}
        is3DMode={false}
        hasRoute={true}
        onToggle3D={jest.fn()}
        bearingAnim={new Animated.Value(0)}
        onResetOrientation={jest.fn()}
        locationLoading={false}
        onGetLocation={jest.fn()}
        enableFullscreen={true}
        onOpenFullscreen={jest.fn()}
        mapHeight={400}
      />
    </SafeAreaProvider>
  );
}

describe('the activity map control column', () => {
  it('starts below the inset and the back button row', () => {
    renderControls();

    const column = screen.getByTestId('activity-map-controls');
    const top = StyleSheet.flatten(column.props.style).top;
    expect(top).toBeGreaterThanOrEqual(INSET_TOP + HERO_HEADER_HEIGHT);
  });
});
