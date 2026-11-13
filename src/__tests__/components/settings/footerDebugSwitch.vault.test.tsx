/**
 * Scenario: once unlocked, the debug mode switch in the settings footer is a
 * control a screen reader has to name and a tap on its label has to reach.
 *
 * Expected behaviour: it is one switch named by its title, and pressing the row
 * turns debug mode on.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { FooterSection } from '@/features/settings/components/FooterSection';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `t(${key})` }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));

describe('the debug mode switch', () => {
  beforeEach(() => {
    useDebugStore.setState({ unlocked: true, enabled: false });
  });

  it('is hidden until unlocked', async () => {
    useDebugStore.setState({ unlocked: false, enabled: false });
    const { queryByRole } = await render(<FooterSection />);

    expect(queryByRole('switch')).toBeNull();
  });

  it('is named by its title once unlocked', async () => {
    const { getByRole } = await render(<FooterSection />);

    const control = getByRole('switch', { name: 't(settings.debugMode)' });
    expect(control.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('turns debug mode on from a press on the row', async () => {
    const { getByRole } = await render(<FooterSection />);

    await fireEvent.press(getByRole('switch', { name: 't(settings.debugMode)' }));

    expect(useDebugStore.getState().enabled).toBe(true);
  });
});
