/**
 * Scenario: the settings footer and the experimental page.
 *
 * Expected behaviour: the page row is always shown above the version line with no master switch,
 * five taps still reveal the debug switch, and the page lists one row per feature with its blurb,
 * its own switch and a link to it.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FooterSection } from '@/features/settings/components/FooterSection';
import { ExperimentalFeatures } from '@/features/settings/components/ExperimentalFeatures';
import { EXPERIMENTAL_FEATURES } from '@/features/settings/lib/experimentalFeatures';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { navigateTo } from '@/shared/app/navigation';
import { settings } from 'veloqrs';

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

function withEngine(examples: {
  efficiencyTrendSectionId?: string;
  sectionCorrelationSectionId?: string;
}) {
  (settings.getExperimentalExamples as jest.Mock).mockReturnValue(examples);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExperimentalFeatures />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  withEngine({});
  useDebugStore.setState({ unlocked: false, enabled: false });
  useDebugStore.setState({ experimentalFeatures: {} });
});

describe('the experimental row in the settings footer', () => {
  it('is there with no taps, above the version line, and has no master switch', async () => {
    const screen = await render(<FooterSection />);
    const row = screen.getByTestId('settings-experimental-dashboard-link');
    expect(screen.queryByTestId('settings-experimental-switch')).toBeNull();

    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('settings-experimental-dashboard-link')).toBeLessThan(
      tree.indexOf('settings-version-text')
    );

    await fireEvent.press(row);
    expect(navigateTo).toHaveBeenCalledWith('/experimental');
  });

  it('keeps the debug switch behind five taps on the version line', async () => {
    const { queryByTestId, getByLabelText } = await render(<FooterSection />);
    expect(queryByTestId('settings-debug-switch')).toBeNull();

    for (let i = 0; i < 4; i++) await fireEvent.press(getByLabelText(/t\(settings.version\)/));
    expect(queryByTestId('settings-debug-switch')).toBeNull();

    await fireEvent.press(getByLabelText(/t\(settings.version\)/));
    expect(queryByTestId('settings-debug-switch')).toBeTruthy();
    expect(queryByTestId('settings-experimental-switch')).toBeNull();
  });
});

describe('the experimental page', () => {
  it('opens with a note above the first switch that the features are unfinished previews', async () => {
    const screen = await renderPage();

    expect(screen.getByText('t(experimental.previewNote)')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('experimental-preview-note')).toBeGreaterThanOrEqual(0);
    expect(tree.indexOf('experimental-preview-note')).toBeLessThan(
      tree.indexOf(`experimental-switch-${EXPERIMENTAL_FEATURES[0].key}`)
    );
  });

  it('lists every feature with its blurb and its switch', async () => {
    const screen = await renderPage();

    for (const feature of EXPERIMENTAL_FEATURES) {
      expect(screen.getByText(`t(${feature.titleKey})`)).toBeTruthy();
      expect(screen.getByText(`t(${feature.blurbKey})`)).toBeTruthy();
      expect(screen.getByTestId(`experimental-switch-${feature.key}`)).toBeTruthy();
    }
  });

  it('links each feature to the section the engine names, and the Garmin page', async () => {
    withEngine({ efficiencyTrendSectionId: 'sec-eff', sectionCorrelationSectionId: 'sec-corr' });
    const screen = await renderPage();

    await fireEvent.press(await screen.findByTestId('experimental-link-efficiencyTrends'));
    expect(navigateTo).toHaveBeenLastCalledWith('/section/sec-eff');
    await fireEvent.press(screen.getByTestId('experimental-link-sectionCorrelations'));
    expect(navigateTo).toHaveBeenLastCalledWith('/section/sec-corr');
    await fireEvent.press(screen.getByTestId('experimental-link-garminUpdate'));
    expect(navigateTo).toHaveBeenLastCalledWith('/garmin-connector');
    await fireEvent.press(screen.getByTestId('experimental-link-climbingBests'));
    expect(navigateTo).toHaveBeenLastCalledWith('/best-efforts');
  });

  it('says so, with no link, for a feature the library has no example of', async () => {
    withEngine({ sectionCorrelationSectionId: 'sec-corr' });
    const screen = await renderPage();

    expect(await screen.findByTestId('experimental-no-example-efficiencyTrends')).toBeTruthy();
    expect(screen.queryByTestId('experimental-link-efficiencyTrends')).toBeNull();
    expect(screen.getByTestId('experimental-link-sectionCorrelations')).toBeTruthy();
  });

  it('shows every switch off until tapped, and turns one on without touching the others', async () => {
    const screen = await renderPage();
    for (const feature of EXPERIMENTAL_FEATURES) {
      expect(
        screen.getByTestId(`experimental-switch-${feature.key}`).props.accessibilityState.checked
      ).toBe(false);
    }

    await fireEvent.press(screen.getByTestId('experimental-switch-climbingBests'));

    await waitFor(() =>
      expect(useDebugStore.getState().experimentalFeatures).toEqual({ climbingBests: true })
    );
    expect(
      screen.getByTestId('experimental-switch-efficiencyTrends').props.accessibilityState.checked
    ).toBe(false);
  });
});
