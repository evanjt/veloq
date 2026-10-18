/**
 * Scenario: settings list rows drew their own frame, so some lacked the
 * tap-target floor and drew a second chevron or a border of their own. Rows
 * outside the shared Row drew their own chevron at 20, 22 and 24 pt, and rows
 * that run an action wore the chevron that promises another screen.
 *
 * Expected behaviour: each list row renders the shared Row, whose root is at
 * least the tap-target height and has no border. A row that opens another
 * screen draws the shared chevron and nothing else draws one; a row that
 * leaves for a web page draws the open-in-new glyph instead; a row that acts
 * where it stands, above all a destructive one, draws none.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { layout } from '@/theme';
import { CacheManagementPanel } from '@/features/settings/components/CacheManagementPanel';
import { FooterSection } from '@/features/settings/components/FooterSection';
import { ProfileAccountSection } from '@/features/settings/components/ProfileAccountSection';
import { SettingsNavRow } from '@/features/settings/components/SettingsNavRow';
import { SupportSection } from '@/features/settings/components/SupportSection';
import { settingsStyles } from '@/features/settings/components/settingsStyles';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import AboutScreen from '@/app/about';
import DetectionSettingsScreen from '@/app/detection-settings';
import RecordingSettingsScreen from '@/app/recording-settings';
import { Icon } from '@/shared/ui/Icon';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: jest.fn(),
}));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({
    forceRescan: jest.fn(),
    cancelScan: jest.fn(),
    isScanning: false,
    stillRunning: false,
    result: null,
    failed: false,
    refusal: null,
    clearResult: jest.fn(),
  }),
}));
// The status panels on detection settings read engine state the stub does not
// carry, and none of them draws a row.
jest.mock('@/features/settings/components', () => ({
  ...jest.requireActual('@/features/settings/components'),
  BackgroundJobsActivityBar: () => null,
  ElevationBackfillStatus: () => null,
  CutoverStatus: () => null,
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ cancelQueries: jest.fn(async () => {}), clear: jest.fn() }),
}));

function rootStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved as never) as Record<string, unknown>;
}

/** Every chevron drawn, each named by the testID it carries. */
function chevronIds(tree: Awaited<ReturnType<typeof render>>) {
  return tree
    .UNSAFE_queryAllByType(Icon)
    .filter((node) => node.props.name === 'chevron-right')
    .map((node) => node.props.testID as string | undefined);
}

function expectOnlyRowChevrons(tree: Awaited<ReturnType<typeof render>>, count: number) {
  const ids = chevronIds(tree);
  expect(ids).toHaveLength(count);
  for (const id of ids) expect(id).toBe('row-chevron');
}

describe('settings list rows', () => {
  it('renders the clear-cache row on the shared Row with no chevron, since it acts', async () => {
    const onClearCache = jest.fn();
    const tree = await render(
      <CacheManagementPanel isDark={false} isDemoMode={false} onClearCache={onClearCache} />
    );
    const style = rootStyle(tree.getByTestId('settings-clear-cache'));
    expect(style.minHeight).toBe(layout.minTapTarget);
    expect(style.borderTopWidth).toBeUndefined();
    expect(tree.queryByTestId('row-chevron', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(tree.getByTestId('settings-clear-cache'));
    expect(onClearCache).toHaveBeenCalledTimes(1);
  });

  it('does not run the clear-cache action in demo mode', async () => {
    const onClearCache = jest.fn();
    const { getByTestId } = await render(
      <CacheManagementPanel isDark={false} isDemoMode onClearCache={onClearCache} />
    );
    await fireEvent.press(getByTestId('settings-clear-cache'));
    expect(onClearCache).not.toHaveBeenCalled();
  });

  it('renders the nav row on the shared Row with one chevron', async () => {
    const { getByTestId, getAllByTestId } = await render(
      <SettingsNavRow icon="cog" title="Title" onPress={jest.fn()} testID="nav" />
    );
    const style = rootStyle(getByTestId('nav'));
    expect(style.minHeight).toBe(layout.minTapTarget);
    expect(style.borderTopWidth).toBeUndefined();
    expect(getAllByTestId('row-chevron', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('speaks the nav row subtitle, which holds the current value, after its title', () => {
    const { getByTestId } = render(
      <SettingsNavRow
        icon="cog"
        title="Units"
        subtitle="Furlongs"
        onPress={jest.fn()}
        testID="nav"
      />
    );
    expect(getByTestId('nav').props.accessibilityLabel).toBe('Units, Furlongs');
  });

  it('speaks only the title of a nav row with no subtitle', () => {
    const { getByTestId } = render(
      <SettingsNavRow icon="cog" title="Units" onPress={jest.fn()} testID="nav" />
    );
    expect(getByTestId('nav').props.accessibilityLabel).toBe('Units');
  });

  it('keeps no row frame of its own in settingsStyles', () => {
    expect('actionRow' in settingsStyles).toBe(false);
  });
});

describe('chevrons on the settings screens', () => {
  it('draws the shared chevron on the licences row of About and nowhere else', async () => {
    expectOnlyRowChevrons(await render(<AboutScreen />), 1);
  });

  it('draws the shared chevron on the tour, release notes, About and dashboard rows of the footer', async () => {
    useDebugStore.setState({ unlocked: true, enabled: true });
    try {
      expectOnlyRowChevrons(await render(<FooterSection />), 4);
    } finally {
      useDebugStore.setState({ unlocked: false, enabled: false });
    }
  });

  it('draws no chevron on Support, whose subscription row leaves for a web page', async () => {
    const tree = await render(<SupportSection />);
    expectOnlyRowChevrons(tree, 0);
    expect(tree.getAllByTestId('row-external', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('draws the shared chevron on the recordings, sensors, units and tile slot rows', async () => {
    const tree = await render(<RecordingSettingsScreen />);
    const tileSlots = tree.queryAllByTestId(/^settings-tile-/).length;
    expect(tileSlots).toBeGreaterThan(0);
    expectOnlyRowChevrons(tree, 3 + tileSlots);
  });

  it('draws the shared chevron on both preview rows of detection settings', async () => {
    expectOnlyRowChevrons(await render(<DetectionSettingsScreen />), 2);
  });
});

describe('account rows', () => {
  beforeEach(() => {
    useAuthStore.setState({ authMethod: 'apiKey' });
  });

  it('marks the profile row as a web page and neither sign-out row as anything', async () => {
    const tree = await render(<ProfileAccountSection athlete={{ name: 'Rider' }} />);
    expectOnlyRowChevrons(tree, 0);
    expect(tree.getAllByTestId('row-external', { includeHiddenElements: true })).toHaveLength(1);
    for (const id of ['settings-logout-button', 'settings-logout-clear-button']) {
      const row = tree.getByTestId(id);
      expect(row.findAll((node) => node.props.testID === 'row-chevron')).toHaveLength(0);
    }
  });

  it('draws no chevron on the profile row of the demo account, which opens nothing', async () => {
    useAuthStore.setState({ authMethod: 'demo' });
    expectOnlyRowChevrons(await render(<ProfileAccountSection athlete={{ name: 'Rider' }} />), 0);
  });
});
