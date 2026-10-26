/**
 * Scenario: the settings family drew its group headers several ways, at three
 * sizes and weights, and most of them uppercased the translated string in
 * JavaScript over a style that already uppercases.
 *
 * Expected behaviour: every group header on the hub, About and Recording settings
 * shares one size, weight, tracking and transform, and carries the
 * translation unchanged so case stays presentation. In dark, every Display
 * sub-heading shares one colour and one icon size.
 */

import React from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import SettingsScreen from '@/app/(tabs)/settings';
import AboutScreen from '@/app/about';
import RecordingSettingsScreen from '@/app/recording-settings';
import { DisplaySettings } from '@/features/settings/components/DisplaySettings';
import { colors, darkColors } from '@/theme';

let mockIsDark = false;

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => ['settings'],
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

jest.mock('@/shared/app', () => {
  const actual = jest.requireActual('@/shared/app');
  return {
    ...actual,
    useTheme: () => ({ ...actual.useTheme(), isDark: mockIsDark }),
    useMetricSystem: () => true,
  };
});

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'outdoors', terrain3DMode: 'off' },
  }),
}));

jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ athlete: null }) }));

jest.mock('@/shared/storage/gpsStorage', () => ({
  getAppStorageSize: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  getLastBackupTimestamp: jest.fn().mockReturnValue(null),
}));

jest.mock('@/features/settings', () => ({
  useMapPreferences: (...args: unknown[]) =>
    jest.requireMock('@/features/settings/stores/MapPreferencesContext').useMapPreferences(...args),
  useDashboardPreferences: jest.requireActual('@/features/settings/stores/summaryCardPreferences')
    .useDashboardPreferences,
  useNotificationPreferences: jest.requireActual(
    '@/features/settings/stores/NotificationPreferencesStore'
  ).useNotificationPreferences,
  useLastBackupTimestamp: () => null,
  useGarminConnectorState: () => null,
  useAutoBackupEnabled: () => true,
  SettingsNavRow: jest.requireActual('@/features/settings/components/SettingsNavRow')
    .SettingsNavRow,
  RecordingPermissionSection: () => null,
  settingsStyles: jest.requireActual('@/features/settings/components/settingsStyles')
    .settingsStyles,
  SupportSection: () => null,
  FooterSection: () => null,
  DataAttribution: jest.requireActual('@/features/settings/components/DataAttribution')
    .DataAttribution,
}));

beforeEach(() => {
  mockIsDark = false;
});

/** What makes two headers look the same, read off the rendered heading. */
function headerLook(screen: Awaited<ReturnType<typeof render>>, text: string) {
  const style = StyleSheet.flatten(
    screen.getByRole('header', { name: text }).props.style
  ) as TextStyle;
  return {
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    textTransform: style.textTransform,
    color: style.color,
  };
}

function renderDisplay() {
  return render(
    <DisplaySettings
      themePreference="system"
      onThemeChange={jest.fn()}
      unitPreference="metric"
      onUnitChange={jest.fn()}
      intervalsUnitPreference={null}
      primarySport="Running"
      onSportChange={jest.fn()}
      language="en-GB"
      onLanguageChange={jest.fn()}
    />
  );
}

describe('settings group headers', () => {
  it('draw one way on every settings-family screen, over the translation unchanged', async () => {
    const looks: { screen: string; header: string; look: ReturnType<typeof headerLook> }[] = [];
    const collect = async (
      name: string,
      screen: Awaited<ReturnType<typeof render>>,
      headers: string[]
    ) => {
      for (const header of headers) {
        looks.push({ screen: name, header, look: headerLook(screen, header) });
      }
      await screen.unmount();
    };

    await collect('hub', await render(<SettingsScreen />), [
      'Appearance',
      'Data & recording',
      'Library & backup',
    ]);
    await collect('about', await render(<AboutScreen />), [
      'about.disclaimerTitle',
      'intervals.icu',
      'Veloq',
      'about.dataAttribution',
      'about.mapData',
    ]);
    await collect('recording', await render(<RecordingSettingsScreen />), [
      'Upload',
      'GPS & battery',
      'recording.settingsAutoPause',
      'recording.settingsDataFields',
      'Sensors',
      'recording.settingsUnits',
    ]);

    expect(looks[0].look.textTransform).toBe('uppercase');
    const odd = looks.filter((l) => JSON.stringify(l.look) !== JSON.stringify(looks[0].look));
    expect(odd).toEqual([]);
  });

  it('give every Display sub-heading one colour and one icon size in dark', async () => {
    mockIsDark = true;
    const screen = await renderDisplay();
    const subHeadings = [
      'settings.appearance',
      'settings.units',
      'settings.language',
      'settings.primarySport',
    ];

    const colours = new Set(
      subHeadings.map(
        (s) => (StyleSheet.flatten(screen.getByText(s).props.style) as TextStyle).color
      )
    );
    expect(colours.size).toBe(1);

    const iconSizes = new Set(
      screen
        .UNSAFE_getAllByType(MaterialCommunityIcons)
        .filter((icon) =>
          ['theme-light-dark', 'ruler', 'translate', 'run'].includes(icon.props.name)
        )
        .map((icon) => icon.props.size)
    );
    expect(iconSizes.size).toBe(1);
  });
});

describe('settings row dividers', () => {
  const dividerLooks = (screen: Awaited<ReturnType<typeof render>>) =>
    screen.getAllByTestId('row-divider').map((d) => {
      const style = StyleSheet.flatten(d.props.style) as ViewStyle;
      return { height: style.height, colour: style.backgroundColor, inset: style.marginLeft };
    });

  it.each([
    ['light', false, colors.border],
    ['dark', true, darkColors.border],
  ])(
    'separate the hub and About rows with one soft hairline past the icon in %s',
    async (_n, isDark, colour) => {
      mockIsDark = isDark;
      const expected = { height: StyleSheet.hairlineWidth, colour, inset: 48 };

      const hub = await render(<SettingsScreen />);
      // Three groups of three, four and three rows: one divider between each pair.
      expect(dividerLooks(hub)).toEqual(Array(2 + 3 + 2).fill(expected));
      await hub.unmount();

      const about = await render(<AboutScreen />);
      // Three intervals.icu rows and six Veloq rows: one divider between each pair.
      expect(dividerLooks(about)).toEqual(Array(2 + 5).fill(expected));
      await about.unmount();
    }
  );
});
