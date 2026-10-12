/**
 * Scenario: the login screen's standalone links, drawn at caption and small
 * body size beside a separator or above a field.
 *
 * Expected behaviour: each link's drawn height plus its hit slop reaches
 * `layout.minTapTarget`.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import LoginScreen from '@/app/login';
import { i18n, initialiseI18n } from '@/i18n';
import { layout } from '@/theme/layout';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ clear: jest.fn() }),
}));
jest.mock('@/features/auth/hooks/useApiKeyLogin', () => ({
  useApiKeyLogin: () => ({ handleApiKeyLogin: jest.fn(), isApiKeyLoading: false }),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
  getNativeModule: () => null,
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));

type Slop = { top?: number; bottom?: number; left?: number; right?: number } | undefined;

function reach(node: { props: { style?: unknown; hitSlop?: Slop } }) {
  const resolved =
    typeof node.props.style === 'function'
      ? (node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : node.props.style;
  const style = StyleSheet.flatten(resolved as never) as { minHeight?: number; height?: number };
  const slop = node.props.hitSlop;
  return {
    height:
      Math.max(style.height ?? 0, style.minHeight ?? 0) + (slop?.top ?? 0) + (slop?.bottom ?? 0),
  };
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the login screen links', () => {
  it('holds each standalone link to the tap-target floor', () => {
    render(<LoginScreen />);

    for (const label of [
      i18n.t('about.veloqPrivacy'),
      i18n.t('login.privacyPolicy'),
      i18n.t('login.termsOfService'),
    ]) {
      expect(reach(screen.getByLabelText(label)).height).toBeGreaterThanOrEqual(
        layout.minTapTarget
      );
    }
  });
});
