/**
 * Scenario: the settings footer said "Version 0.4.0" and nothing else, so an
 * install hours behind main looked exactly like one cut a minute ago.
 *
 * Expected behaviour: the version line carries the commit the build was made
 * from, and is the version alone when the build carries no stamp.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { FooterSection } from '@/features/settings/components/FooterSection';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `t(${key})` }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/settings/components/whatsNew/slides', () => ({ getAllSlides: () => [] }));

const expoConfig: { version: string; extra: Record<string, unknown> } = {
  version: '0.4.0',
  extra: {},
};
jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  __esModule: true,
  default: {
    get expoConfig() {
      return expoConfig;
    },
  },
}));

function versionLine() {
  const { getByTestId } = render(<FooterSection />);
  return getByTestId('settings-version-text').props.children.join('');
}

describe('the settings version line', () => {
  it('names the commit the build was made from', () => {
    expoConfig.extra = { buildCommit: 'a8f276dff' };
    expect(versionLine()).toBe('t(settings.version) 0.4.0 (a8f276dff)');
  });

  it('marks a build made from a dirty tree', () => {
    expoConfig.extra = { buildCommit: 'a8f276dff+' };
    expect(versionLine()).toBe('t(settings.version) 0.4.0 (a8f276dff+)');
  });

  it('falls back to the version alone when nothing stamped the build', () => {
    expoConfig.extra = {};
    expect(versionLine()).toBe('t(settings.version) 0.4.0');
  });
});
