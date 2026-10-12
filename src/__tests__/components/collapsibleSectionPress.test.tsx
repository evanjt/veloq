/**
 * Scenario: a collapsible header shrank on touch-down and fired a haptic
 * before a scroll could take the touch, and drew no ripple on Android.
 *
 * Expected behaviour: touch-down fires nothing, a press fires one selection
 * tick and toggles, and the header passes the shared Android ripple.
 */
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import * as haptics from '@/shared/ui/haptics';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

// The ripple Android selects, so the header is checked against the value it
// gets on that platform.
jest.mock('@/shared/ui/pressFeedback', () => ({
  ...jest.requireActual('@/shared/ui/pressFeedback'),
  pressRipple: { borderless: false },
}));

// `CollapsibleSection` reaches the app barrel for `useTheme`, and the barrel
// pulls the IAP binding in behind it.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

function renderSection(onToggle: (expanded: boolean) => void) {
  return render(
    <CollapsibleSection title="Gear" expanded={false} onToggle={onToggle} testID="gear-header">
      <Text>content</Text>
    </CollapsibleSection>
  );
}

afterEach(() => jest.clearAllMocks());

it('fires no haptic when a touch lands on the header', async () => {
  const { getByTestId } = await renderSection(jest.fn());

  await fireEvent(getByTestId('gear-header'), 'pressIn');
  await fireEvent(getByTestId('gear-header'), 'pressOut');

  expect(haptics.selection).not.toHaveBeenCalled();
  expect(haptics.light).not.toHaveBeenCalled();
  expect(haptics.medium).not.toHaveBeenCalled();
});

it('fires one selection tick and toggles on a press', async () => {
  const onToggle = jest.fn();
  const { getByTestId } = await renderSection(onToggle);

  await fireEvent.press(getByTestId('gear-header'));

  expect(haptics.selection).toHaveBeenCalledTimes(1);
  expect(haptics.light).not.toHaveBeenCalled();
  expect(onToggle).toHaveBeenCalledWith(true);
});

it('draws the shared ripple on Android', async () => {
  const { UNSAFE_root } = await renderSection(jest.fn());

  const header = UNSAFE_root.find(
    (node) => node.props.testID === 'gear-header' && 'android_ripple' in node.props
  );
  expect(header.props.android_ripple).toEqual({ borderless: false });
});
