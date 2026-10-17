/**
 * Scenario: every route the root stack presents as a sheet is opened with input it accepts.
 *
 * Expected behaviour: each sheet has exactly one heading, drawn by the shared title row in the one
 * sheet-title style. On iOS a sheet that chooses or edits something leads its title row with the
 * shared Cancel, a sheet that only shows something trails it with a close, the shared icon button
 * with a translated label, and a sheet that ends on its own dismiss action carries neither. On
 * Android the title row carries no control, left aligned, since drag, the scrim and back dismiss
 * the sheet.
 */
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SCREEN_SHEETS } from '@/shared/app/screenHeaders';
import { openSheet } from '@/shared/app/sheetRequest';
import { IconButton } from '@/shared/ui/IconButton';
import { SheetHeader } from '@/shared/ui/SheetHeader';
import { TextField } from '@/shared/ui/TextField';
import { i18n, initialiseI18n } from '@/i18n';
import { colors, darkColors, typography } from '@/theme';

const mockPush = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getSetting: () => null, setSetting: () => {} }),
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useGroupSummaries: () => ({ totalCount: 0, summaries: [] }),
}));
jest.mock('@/features/routes/hooks/useMergeSections', () => ({
  useMergeSections: () => ({ merge: jest.fn(), previewDropped: () => [] }),
}));
jest.mock('@/features/insights/components/content/InsightDetailContent', () => ({
  InsightDetailContent: () => null,
}));
jest.mock('@/shared/storage/platformRecord', () => ({ platformRecordUri: () => null }));
jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  getWebdavConfig: () => ({ url: 'https://example.invalid/backups' }),
  initWebdavConfig: async () => {},
}));
jest.mock('@/features/settings/lib/autobackup/backends', () => ({
  webdavBackend: { isAvailable: async () => true, listBackups: async () => [] },
}));
jest.mock('@/features/settings/hooks/useBackup', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
}));
jest.mock('@/features/settings/components/WebdavConfigForm', () => ({
  WebdavConfigForm: () => null,
}));

const SECTION = (id: string, name: string, visitCount: number) => ({
  id,
  name,
  sportTypes: ['Ride'],
  visitCount,
  distanceMeters: 600,
});

/**
 * How a sheet is left on iOS: the shared Cancel for a sheet that chooses or edits something, the
 * close for one that only shows something, or its own last action.
 */
type Dismiss = 'cancel' | 'close' | 'own';

/** Each sheet route, the input it is opened with, and how it is left. */
const SHEETS: Record<
  string,
  { load: () => React.ComponentType; input?: unknown; dismiss: Dismiss }
> = {
  'sheets/activity-type': {
    load: () => require('@/app/sheets/activity-type').default,
    input: { selectedType: 'Ride', mode: 'review' },
    dismiss: 'cancel',
  },
  'sheets/insight': {
    load: () => require('@/app/sheets/insight').default,
    input: {
      id: 'climb',
      title: 'Hill repeat',
      subtitle: 'Three visits',
      category: 'section_changed',
      priority: 1,
      icon: 'history',
      iconTone: 'info',
      timestamp: 0,
      isNew: false,
    },
    dismiss: 'close',
  },
  'sheets/tile-cache-budget': {
    load: () => require('@/app/sheets/tile-cache-budget').default,
    input: { budgetMb: 100 },
    dismiss: 'cancel',
  },
  'sheets/param-editor': {
    load: () => require('@/app/sheets/param-editor').default,
    input: {
      kind: 'param',
      key: 'minSectionLength',
      label: 'Shortest section',
      initial: '150',
      unit: null,
    },
    dismiss: 'cancel',
  },
  'sheets/day-activities': {
    load: () => require('@/app/sheets/day-activities').default,
    input: { activities: [{ id: 'a1', name: 'Morning spin', type: 'Ride', load: 40 }] },
    dismiss: 'cancel',
  },
  'sheets/smoothing': {
    load: () => require('@/app/sheets/smoothing').default,
    input: { window: 7 },
    dismiss: 'cancel',
  },
  'sheets/stat-detail': {
    load: () => require('@/app/sheets/stat-detail').default,
    input: { title: 'Cadence', value: '88', icon: 'speedometer', color: '#336699' },
    dismiss: 'close',
  },
  'sheets/chart-data': {
    load: () => require('@/app/sheets/chart-data').default,
    input: { title: 'Kiln output', columns: ['Day', 'Output (W)'], rows: [] },
    dismiss: 'close',
  },
  'sheets/strength-pairs-info': {
    load: () => require('@/app/sheets/strength-pairs-info').default,
    dismiss: 'close',
  },
  'sheets/field-picker': {
    load: () => require('@/app/sheets/field-picker').default,
    input: { selectedField: null },
    dismiss: 'cancel',
  },
  'sheets/route-overlay': {
    load: () => require('@/app/sheets/route-overlay').default,
    input: { activityType: 'Ride', selectedRouteId: null },
    dismiss: 'cancel',
  },
  'sheets/merge-candidates': {
    load: () => require('@/app/sheets/merge-candidates').default,
    input: { candidates: [] },
    dismiss: 'cancel',
  },
  'sheets/merge-confirm': {
    load: () => require('@/app/sheets/merge-confirm').default,
    input: { primary: SECTION('a', 'North loop', 5), secondary: SECTION('b', 'South loop', 2) },
    dismiss: 'cancel',
  },
  'sheets/section-chooser': {
    load: () => require('@/app/sheets/section-chooser').default,
    input: { sections: [{ id: 'ridge', name: 'Ridge Road', distanceMeters: 1200 }] },
    dismiss: 'cancel',
  },
  'sheets/explainer': {
    load: () => require('@/app/sheets/explainer').default,
    input: { title: 'Tide tables', body: 'When the water turns.' },
    dismiss: 'close',
  },
};

async function openRoute(route: string) {
  const sheet = SHEETS[route];
  if (sheet.input !== undefined) {
    void openSheet(route, sheet.input);
    mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  }
  const Route = sheet.load();
  await render(<Route />);
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});
beforeEach(() => {
  mockPush.mockClear();
  mockParams = {};
});

it('covers every sheet route', () => {
  expect(Object.keys(SHEETS).sort()).toEqual(Object.keys(SCREEN_SHEETS).sort());
});

const realOS = Platform.OS;
const realVersion = Platform.Version;
function setPlatform(os: 'ios' | 'android', version: string | number) {
  Platform.OS = os;
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
}
afterEach(() => {
  setPlatform(realOS as 'ios' | 'android', realVersion);
});

describe.each(Object.keys(SCREEN_SHEETS))('%s', (route) => {
  it.each([
    ['ios', '26.2'],
    ['ios', '18.5'],
    ['android', 35],
  ] as const)(
    'paints no fill at its root on %s %s, leaving the sheet frame the one background',
    async (os, version) => {
      setPlatform(os, version);
      await openRoute(route);
      const tree = screen.toJSON();
      const roots = Array.isArray(tree) ? tree : [tree];
      expect(roots.length).toBeGreaterThan(0);
      for (const root of roots) {
        expect(StyleSheet.flatten(root?.props.style)?.backgroundColor).toBeUndefined();
      }
      const surfaces = [colors.surface, darkColors.surface];
      // A text field fills its own box, a control on the sheet rather than the sheet's fill.
      const insideField = (node: ReactTestInstance) => {
        for (let up = node.parent; up; up = up.parent) if (up.type === TextField) return true;
        return false;
      };
      const painted = screen.UNSAFE_root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          surfaces.includes(StyleSheet.flatten(node.props.style)?.backgroundColor) &&
          !insideField(node)
      );
      expect(painted).toHaveLength(0);
    }
  );

  it.each(['ios', 'android'] as const)(
    'has one heading in the sheet-title style on %s',
    async (os) => {
      Platform.OS = os;
      await openRoute(route);
      const headings = screen.getAllByRole('header');
      expect(headings).toHaveLength(1);
      const style = StyleSheet.flatten(headings[0].props.style);
      expect(style.fontSize).toBe(typography.cardTitle.fontSize);
      expect(style.fontWeight).toBe(typography.cardTitle.fontWeight);
      const shared = screen.UNSAFE_getByType(SheetHeader);
      expect(shared.findAll((node) => node === headings[0])).toHaveLength(1);
    }
  );

  it('is left on iOS the way its kind of sheet is left, from the shared title row', async () => {
    Platform.OS = 'ios';
    await openRoute(route);
    const header = screen.UNSAFE_getByType(SheetHeader);
    const inHeader = (label: string) =>
      header.findAll(
        (node) => typeof node.type !== 'string' && node.props.accessibilityLabel === label
      );
    const cancel = i18n.t('common.cancel');
    const close = i18n.t('common.close');
    const closes = screen.queryAllByLabelText(close);
    const sharedCloses = screen
      .UNSAFE_queryAllByType(IconButton)
      .filter((button) => button.props.accessibilityLabel === close);

    const dismiss = SHEETS[route].dismiss;
    expect(closes).toHaveLength(dismiss === 'close' ? 1 : 0);
    expect(sharedCloses).toHaveLength(closes.length);
    expect(inHeader(close).length > 0).toBe(dismiss === 'close');
    expect(inHeader(cancel).length > 0).toBe(dismiss === 'cancel');
  });

  it('draws no control in its title row on Android, left aligned', async () => {
    Platform.OS = 'android';
    await openRoute(route);
    const header = screen.UNSAFE_getByType(SheetHeader);
    expect(header.findAll((node) => node.props.accessibilityRole === 'button')).toHaveLength(0);
    expect(screen.queryAllByLabelText(i18n.t('common.close'))).toHaveLength(0);
    const style = StyleSheet.flatten(screen.getByRole('header').props.style);
    expect(style.textAlign ?? 'auto').not.toBe('center');
  });
});
