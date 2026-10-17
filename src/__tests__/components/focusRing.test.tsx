/**
 * Scenario: on Android a keyboard or switch-access user moves focus onto a
 * shared control.
 *
 * Expected behaviour: the control draws the 2 pt `focusRing` outline outside
 * its box while it holds focus, takes it off on blur and draws it again on the
 * next focus. iOS draws none of ours, so no second ring sits over the system's.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { Button, ToggleButton } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { focusRing } from '@/shared/ui/pressFeedback';
import { Row } from '@/shared/ui/Row';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { TextLink } from '@/shared/ui/TextLink';
import { colors, darkColors, spacing, stroke } from '@/theme';

jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const actual = jest.requireActual('react-native/Libraries/Utilities/Platform');
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      OS: 'android',
      select: (spec: Record<string, unknown>) =>
        'android' in spec ? spec.android : 'native' in spec ? spec.native : spec.default,
    },
  };
});
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

const ring = (outlineColor: string) => ({
  outlineWidth: stroke.two,
  outlineStyle: 'solid',
  outlineColor,
  outlineOffset: spacing.xxs,
});

describe('focusRing', () => {
  it('is the 2 pt focus-ring outline when focused on Android, in both themes', () => {
    expect(focusRing(true, false, 'android')).toEqual(ring(colors.focusRing));
    expect(focusRing(true, true, 'android')).toEqual(ring(darkColors.focusRing));
  });

  it('is nothing when not focused', () => {
    expect(focusRing(false, false, 'android')).toBeNull();
    expect(focusRing(false, true, 'android')).toBeNull();
  });

  it('is nothing on iOS, where the system decides whether it draws a ring', () => {
    expect(focusRing(true, false, 'ios')).toBeNull();
    expect(focusRing(true, true, 'ios')).toBeNull();
  });
});

const noop = () => {};

const controls: [string, () => React.ReactElement][] = [
  ['Button', () => <Button testID="target" label="Plant" onPress={noop} />],
  ['ToggleButton', () => <ToggleButton testID="target" label="Pears" onPress={noop} />],
  [
    'IconButton',
    () => (
      <IconButton testID="target" accessibilityLabel="Prune" onPress={noop}>
        <Text>x</Text>
      </IconButton>
    ),
  ],
  ['TextLink', () => <TextLink testID="target" label="Orchard map" onPress={noop} />],
  [
    'Row',
    () => (
      <Row testID="target" onPress={noop} accessibilityLabel="Hedgerow" behaviour="navigate">
        <Text>Hedgerow</Text>
      </Row>
    ),
  ],
  [
    'SwitchRow',
    () => <SwitchRow testID="target" title="Frost alerts" value={false} onValueChange={noop} />,
  ],
];

function outlineOf(target: ReactTestInstance) {
  return StyleSheet.flatten(target.props.style)?.outlineColor;
}

describe.each(controls)('%s on Android keyboard focus', (_name, draw) => {
  it('draws the ring on focus, takes it off on blur and draws it again', () => {
    render(draw());
    const target = screen.getByTestId('target');
    expect(outlineOf(target)).toBeUndefined();

    fireEvent(target, 'focus');
    expect(outlineOf(screen.getByTestId('target'))).toBe(colors.focusRing);

    fireEvent(screen.getByTestId('target'), 'blur');
    expect(outlineOf(screen.getByTestId('target'))).toBeUndefined();

    fireEvent(screen.getByTestId('target'), 'focus');
    expect(outlineOf(screen.getByTestId('target'))).toBe(colors.focusRing);
  });
});
