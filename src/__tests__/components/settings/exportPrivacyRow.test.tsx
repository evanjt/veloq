/**
 * Scenario: a bulk export carries the athlete's door at full precision, and the
 * engine can already trim it. The trim is off until a home is set, and no
 * screen sets one, so the protection exists and never fires.
 *
 * Expected behaviour: a row that turns trimming on, offers the home the engine
 * guessed for confirmation, and writes all three settings. Until a home is
 * confirmed the switch cannot be turned on, because a radius with no home
 * trims nothing and would read as protection that is not there.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { ExportPrivacyRow } from '@/features/settings/components/ExportPrivacyRow';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
// The interpolated values are the point of the count line, so the stub keeps
// them and drops only the fallback string.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: unknown) => {
      if (typeof vars !== 'object' || vars === null) return key;
      const { defaultValue: _drop, ...rest } = vars as Record<string, unknown>;
      return Object.keys(rest).length === 0 ? key : `${key}:${JSON.stringify(rest)}`;
    },
  }),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const HOME = {
  latitude: 46.2333,
  longitude: 7.36,
  activityCount: 402,
  endpointShare: 0.24,
};

/** The count the engine reports rises with the radius, as a real library does. */
const previewFor = (radius: number) => ({
  withTrack: 402,
  touched: radius === 0 ? 0 : Math.round(radius / 10),
  dropped: radius >= 500 ? 3 : 0,
});

function engineWith(over: Record<string, unknown> = {}) {
  const settings = new Map<string, string>();
  const engine = {
    suggestExportHome: jest.fn(() => HOME),
    exportPrivacyPreview: jest.fn((_lat: number, _lng: number, radius: number) =>
      previewFor(radius)
    ),
    getSetting: jest.fn((key: string) => settings.get(key)),
    setSetting: jest.fn((key: string, value: string) => settings.set(key, value)),
    ...over,
  };
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  return { engine, settings };
}

afterEach(() => jest.clearAllMocks());

describe('the export privacy row', () => {
  it('offers the home the engine guessed', async () => {
    engineWith();
    const tree = render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-home')).toBeTruthy());
  });

  it('cannot be turned on before a home is confirmed', async () => {
    const { settings } = engineWith();
    const tree = render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());

    fireEvent(tree.getByTestId('export-privacy-switch'), 'valueChange', true);

    expect(settings.get('__export_privacy_radius_m')).toBeUndefined();
  });

  it('writes all three settings once the home is confirmed', async () => {
    const { settings } = engineWith();
    const tree = render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-confirm')).toBeTruthy());

    fireEvent.press(tree.getByTestId('export-privacy-confirm'));
    fireEvent(tree.getByTestId('export-privacy-switch'), 'valueChange', true);

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('100'));
    expect(Number(settings.get('__export_home_lat'))).toBeCloseTo(HOME.latitude, 4);
    expect(Number(settings.get('__export_home_lng'))).toBeCloseTo(HOME.longitude, 4);
  });

  it('turns the trim off by writing a zero radius, which is the engine off switch', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());

    fireEvent(tree.getByTestId('export-privacy-switch'), 'valueChange', false);

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('0'));
    // The home stays, so turning it back on does not ask again.
    expect(settings.get('__export_home_lat')).toBe(String(HOME.latitude));
  });

  it('says there is nothing to suggest rather than offering a point at zero', async () => {
    engineWith({ suggestExportHome: jest.fn(() => null) });
    const tree = render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-no-home')).toBeTruthy());
    expect(tree.queryByTestId('export-privacy-confirm')).toBeNull();
  });

  it('reads an install that already has a home as on', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');

    const tree = render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-switch').props.value).toBe(true));
  });

  it('names how many rides the radius reaches, not just the metres', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');

    const tree = render(<ExportPrivacyRow />);

    const count = await waitFor(() => tree.getByTestId('export-privacy-count'));
    expect(count.props.children).toContain('10');
    expect(count.props.children).toContain('402');
  });

  it('changes the count when the radius changes', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-radius-500')).toBeTruthy());

    fireEvent.press(tree.getByTestId('export-privacy-radius-500'));

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('500'));
    expect(tree.getByTestId('export-privacy-count').props.children).toContain('50');
  });

  it('reports that nothing is trimmed in the off position', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '0');

    const tree = render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-count')).toBeTruthy());
    expect(tree.getByTestId('export-privacy-count').props.children).toContain(
      'settings.exportPrivacyNothingTrimmed'
    );
    expect(tree.queryByTestId('export-privacy-radius-500')).toBeNull();
  });

  it('says nothing about counts when the engine cannot preview', async () => {
    const { settings } = engineWith({ exportPrivacyPreview: undefined });
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');

    const tree = render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());
    expect(tree.queryByTestId('export-privacy-count')).toBeNull();
  });
});
