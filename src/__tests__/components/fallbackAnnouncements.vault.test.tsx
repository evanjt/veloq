/**
 * Scenario: a fallback, an empty state or a failed read appears in place of
 * what the athlete was looking at, with no focus change to tell a screen
 * reader anything happened.
 *
 * Expected behaviour: each one sits in a live region, assertive for a failure
 * and polite otherwise, and is announced once on iOS with its text. A
 * full-screen fallback's title is a header.
 */

import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ScreenErrorBoundary } from '@/shared/ui/ScreenErrorBoundary';
import { GlobalErrorBoundary } from '@/shared/ui/GlobalErrorBoundary';
import { ComponentErrorBoundary } from '@/shared/ui/ComponentErrorBoundary';
import { ChartErrorBoundary } from '@/shared/ui/ChartErrorBoundary';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { BodyNotDownloaded } from '@/shared/ui/BodyNotDownloaded';

jest.mock('@/shared/debug/boundaryCrash', () => ({ recordBoundaryCrash: jest.fn() }));
jest.mock('@/shared/app', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('@/shared/app/useTheme', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

function Broken(): React.ReactElement {
  throw new Error('render failed');
}

type Node = { props: Record<string, unknown>; parent: unknown };

function liveRegionOf(node: Node): unknown {
  let at: Node | null = node;
  while (at) {
    if (at.props.accessibilityLiveRegion) return at.props.accessibilityLiveRegion;
    at = at.parent as Node | null;
  }
  return undefined;
}

const announce = AccessibilityInfo.announceForAccessibility as jest.Mock;
const os = Platform.OS;
let consoleError: jest.SpyInstance;

beforeEach(() => {
  Platform.OS = 'ios';
  announce.mockClear();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  Platform.OS = os;
  consoleError.mockRestore();
});

describe('the screen fallback', () => {
  it('is announced with its title, assertively, and the title is a header', async () => {
    jest.spyOn(router, 'canGoBack').mockReturnValue(false);
    const tree = await render(
      <ScreenErrorBoundary screenName="Orchard">
        <Broken />
      </ScreenErrorBoundary>
    );

    const title = tree.getByText('emptyState.error.title');
    expect(title.props.accessibilityRole).toBe('header');
    expect(liveRegionOf(title)).toBe('assertive');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('emptyState.error.title'));
  });
});

describe('the app fallback', () => {
  it('is announced with its title and body, assertively, and the title is a header', async () => {
    const tree = await render(
      <GlobalErrorBoundary>
        <Broken />
      </GlobalErrorBoundary>
    );

    const title = tree.getByText('Something went wrong');
    expect(title.props.accessibilityRole).toBe('header');
    expect(liveRegionOf(title)).toBe('assertive');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/Something went wrong.*unaffected/)
    );
  });
});

describe('the component and chart fallbacks', () => {
  it('announces a component that could not render', async () => {
    const tree = await render(
      <ComponentErrorBoundary part="map" debugName="Orchard map">
        <Broken />
      </ComponentErrorBoundary>
    );

    expect(liveRegionOf(tree.getByText('errorState.unableToLoad'))).toBe('assertive');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('errorState.unableToLoad'));
  });

  it('announces a chart that could not render', async () => {
    const tree = await render(
      <ChartErrorBoundary>
        <Broken />
      </ChartErrorBoundary>
    );

    expect(liveRegionOf(tree.getByText('errorState.unableToDisplayChart'))).toBe('assertive');
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('errorState.unableToDisplayChart')
    );
  });
});

describe('empty states and failed reads', () => {
  it('announces an empty state politely with its title and description', async () => {
    const tree = await render(
      <EmptyState icon="tree" title="No pears picked" description="Pick one to see it here" />
    );

    expect(liveRegionOf(tree.getByText('No pears picked'))).toBe('polite');
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/No pears picked.*Pick one to see it here/)
    );
  });

  it('announces a failed read assertively, in place of a screen or inside a card', async () => {
    const screen = await render(
      <ErrorState error={new Error('busy')} onRetry={jest.fn()} testID="orchard-screen" />
    );
    expect(liveRegionOf(screen.getByText('emptyState.error.title'))).toBe('assertive');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/emptyState\.error\.title.*emptyState\.error\.description/)
    );
    await screen.unmount();

    const inline = await render(
      <ErrorState
        variant="inline"
        error={new Error('busy')}
        onRetry={jest.fn()}
        testID="orchard-card"
      />
    );
    expect(liveRegionOf(inline.getByTestId('orchard-card'))).toBe('assertive');
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('emptyState.error.description');
  });

  it('announces a body that is not downloaded', async () => {
    const tree = await render(
      <BodyNotDownloaded
        message="The orchard plan is not downloaded"
        status="timedOut"
        onRetry={jest.fn()}
        testID="orchard-body"
      />
    );

    expect(liveRegionOf(tree.getByText('The orchard plan is not downloaded'))).toBe('polite');
    expect(announce).toHaveBeenCalledWith('The orchard plan is not downloaded');
  });
});
