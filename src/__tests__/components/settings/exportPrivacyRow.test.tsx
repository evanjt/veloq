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
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import {
  ExportPrivacyRow,
  endpointSharePercent,
} from '@/features/settings/components/ExportPrivacyRow';
import { getEngine } from '@/shared/native/engine';
import type { HomeRadiusMapProps } from '@/features/maps';
import { colors } from '@/theme';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
// The map is the maps feature's, tested there. Here the row is asked what it
// told the map to draw and what it did when the pin moved.
const mapProps: HomeRadiusMapProps[] = [];
jest.mock('@/features/maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    HomeRadiusMap: (props: HomeRadiusMapProps) => {
      mapProps.push(props);
      return <View testID={props.testID} />;
    },
  };
});
const mockUnits = { metric: true };
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockUnits.metric,
}));
// The interpolated values are the point of the count line, so the stub keeps
// them and drops only the fallback string.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: unknown) => {
      if (typeof vars !== 'object' || vars === null) return key;
      const { defaultValue: _drop, ...rest } = vars as Record<string, unknown>;
      return Object.keys(rest).length === 0 ? key : `${key}:${JSON.stringify(rest)}`;
    },
  }),
}));

const mockOpenExplainer = jest.fn();
jest.mock('@/shared/app/explainer', () => ({
  openExplainer: (...a: unknown[]) => mockOpenExplainer(...a),
}));

/** The text the info button holds, which is where the row's description lives. */
async function describedRadius(tree: Awaited<ReturnType<typeof render>>): Promise<string> {
  await fireEvent.press(tree.getByTestId('export-privacy-info'));
  return String(mockOpenExplainer.mock.calls.at(-1)?.[0].body);
}

function titleColour(tree: Awaited<ReturnType<typeof render>>): unknown {
  return StyleSheet.flatten(tree.getByTestId('export-privacy-title').props.style).color;
}

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
    getBackupScreenData: jest.fn(() => {
      const homeLat = settings.get('__export_home_lat');
      const homeLng = settings.get('__export_home_lng');
      return {
        homeLat,
        homeLng,
        radiusM: settings.get('__export_privacy_radius_m'),
        suggestion:
          homeLat && homeLng
            ? null
            : typeof over.suggestExportHome === 'function'
              ? (over.suggestExportHome as () => typeof HOME | null)()
              : HOME,
      };
    }),
    subscribe: jest.fn(() => () => undefined),
    ...over,
  };
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  return { engine, settings };
}

afterEach(() => {
  jest.clearAllMocks();
  mapProps.length = 0;
  mockUnits.metric = true;
});

const lastMap = () => mapProps[mapProps.length - 1];

describe('the export privacy row', () => {
  it('reads the fixed settings in one screen call', async () => {
    const { engine } = engineWith({
      getSetting: jest.fn(() => {
        throw new Error('separate read');
      }),
    });
    await render(<ExportPrivacyRow />);
    expect(engine.getBackupScreenData).toHaveBeenCalledTimes(1);
    expect(engine.getSetting).not.toHaveBeenCalled();
  });

  it('offers the home the engine guessed', async () => {
    engineWith();
    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-home')).toBeTruthy());
  });

  it('cannot be turned on before a home is confirmed', async () => {
    const { settings } = engineWith();
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());

    await fireEvent.press(tree.getByTestId('export-privacy-switch'));

    expect(settings.get('__export_privacy_radius_m')).toBeUndefined();
  });

  it('looks off limits before a home is set, and says the home is what it needs', async () => {
    engineWith();
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());

    expect(tree.getByTestId('export-privacy-switch')).toBeDisabled();
    expect(titleColour(tree)).toBe(colors.textDisabled);
    // The reason names where the home is set, which is the suggestion and the map below.
    expect(tree.getByTestId('export-privacy-needs-home').props.children).toBe(
      'settings.exportPrivacyNeedsHome'
    );
  });

  it('says a home is needed even when there is no place to suggest', async () => {
    engineWith({ suggestExportHome: jest.fn(() => null) });
    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-needs-home')).toBeTruthy());
    expect(tree.getByTestId('export-privacy-needs-home').props.children).toBe(
      'settings.exportPrivacyNeedsHomeNoSuggestion'
    );
    expect(tree.getByTestId('export-privacy-switch')).toBeDisabled();
  });

  it('looks switchable and drops the reason once the home is confirmed', async () => {
    const { settings } = engineWith();
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-confirm')).toBeTruthy());

    await fireEvent.press(tree.getByTestId('export-privacy-confirm'));

    await waitFor(() => expect(tree.queryByTestId('export-privacy-needs-home')).toBeNull());
    expect(tree.getByTestId('export-privacy-switch')).not.toBeDisabled();
    expect(titleColour(tree)).toBe(colors.textPrimary);
    await fireEvent.press(tree.getByTestId('export-privacy-switch'));
    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('100'));
  });

  it('looks switchable on an install that already has a home', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '0');

    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());
    expect(tree.getByTestId('export-privacy-switch')).not.toBeDisabled();
    expect(tree.queryByTestId('export-privacy-needs-home')).toBeNull();
  });

  it('writes all three settings once the home is confirmed', async () => {
    const { settings } = engineWith();
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-confirm')).toBeTruthy());

    await fireEvent.press(tree.getByTestId('export-privacy-confirm'));
    await fireEvent.press(tree.getByTestId('export-privacy-switch'));

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('100'));
    expect(Number(settings.get('__export_home_lat'))).toBeCloseTo(HOME.latitude, 4);
    expect(Number(settings.get('__export_home_lng'))).toBeCloseTo(HOME.longitude, 4);
  });

  it('turns the trim off by writing a zero radius, which is the engine off switch', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());

    await fireEvent.press(tree.getByTestId('export-privacy-switch'));

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('0'));
    // The home stays, so turning it back on does not ask again.
    expect(settings.get('__export_home_lat')).toBe(String(HOME.latitude));
  });

  it('says there is nothing to suggest rather than offering a point at zero', async () => {
    engineWith({ suggestExportHome: jest.fn(() => null) });
    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-no-home')).toBeTruthy());
    expect(tree.queryByTestId('export-privacy-confirm')).toBeNull();
  });

  it('reads an install that already has a home as on', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');

    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeChecked());
  });

  it('names how many rides the radius reaches, not just the metres', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');

    const tree = await render(<ExportPrivacyRow />);

    const count = await waitFor(() => tree.getByTestId('export-privacy-count'));
    expect(count.props.children).toContain('10');
    expect(count.props.children).toContain('402');
  });

  it('changes the count when the radius changes', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-radius-500')).toBeTruthy());

    await fireEvent.press(tree.getByTestId('export-privacy-radius-500'));

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('500'));
    expect(tree.getByTestId('export-privacy-count').props.children).toContain('50');
  });

  it('describes the trim at the radius the row is set to', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-radius-500')).toBeTruthy());

    await fireEvent.press(tree.getByTestId('export-privacy-radius-500'));

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('500'));
    const description = await describedRadius(tree);
    expect(description).toContain('"radius":"500 m"');
    expect(description).not.toContain('"radius":"100 m"');
  });

  it('offers, counts and describes the radius in feet for an imperial athlete', async () => {
    mockUnits.metric = false;
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-radius-500')).toBeTruthy());

    expect(tree.getByTestId('export-privacy-radius-100-label')).toHaveTextContent('328 ft');
    expect(tree.getByTestId('export-privacy-radius-250-label')).toHaveTextContent('820 ft');
    expect(tree.getByTestId('export-privacy-radius-500-label')).toHaveTextContent('1,640 ft');
    expect(tree.getByTestId('export-privacy-count').props.children).toContain('"radius":"328 ft"');
    expect(await describedRadius(tree)).toContain('"radius":"328 ft"');
    // What is stored stays in metres: the unit is how it reads, not what it is.
    await fireEvent.press(tree.getByTestId('export-privacy-radius-250'));
    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('250'));
  });

  it('describes the default radius in the off position, the one turning it on applies', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '0');

    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());
    expect(await describedRadius(tree)).toContain('"radius":"100 m"');
  });

  it('describes the radius a switch back on applies after a pick and a switch off', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-radius-500')).toBeTruthy());
    await fireEvent.press(tree.getByTestId('export-privacy-radius-500'));

    await fireEvent.press(tree.getByTestId('export-privacy-switch'));

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('0'));
    expect(await describedRadius(tree)).toContain('"radius":"500 m"');
    await fireEvent.press(tree.getByTestId('export-privacy-switch'));
    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('500'));
  });

  it('reports that nothing is trimmed in the off position', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '0');

    const tree = await render(<ExportPrivacyRow />);

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

    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-switch')).toBeTruthy());
    expect(tree.queryByTestId('export-privacy-count')).toBeNull();
  });

  it('shows the share of ride ends beside the count as a whole percentage', async () => {
    engineWith();
    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-home')).toBeTruthy());
    expect(JSON.stringify(tree.toJSON())).toContain('\\"share\\":24');
  });

  it('never rounds a non-zero share down to zero', () => {
    expect(endpointSharePercent(0.004)).toBe(1);
    expect(endpointSharePercent(0)).toBe(0);
    expect(endpointSharePercent(1)).toBe(100);
    expect(endpointSharePercent(0.245)).toBe(25);
  });

  it('draws the suggested home on a map before it is confirmed', async () => {
    engineWith();
    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-map')).toBeTruthy());
    expect(lastMap().home).toEqual([HOME.longitude, HOME.latitude]);
    // Off draws what turning it on would cover, not a circle of nothing.
    expect(lastMap().radiusM).toBe(100);
  });

  it('draws the circle at the radius the row is set to', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '500');

    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-map')).toBeTruthy());
    expect(lastMap().radiusM).toBe(500);

    await fireEvent.press(tree.getByTestId('export-privacy-radius-250'));
    await waitFor(() => expect(lastMap().radiusM).toBe(250));
  });

  it('writes both settings when the pin is moved, and draws it there', async () => {
    const { settings } = engineWith();
    settings.set('__export_home_lat', String(HOME.latitude));
    settings.set('__export_home_lng', String(HOME.longitude));
    settings.set('__export_privacy_radius_m', '100');
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-map')).toBeTruthy());

    await act(() => lastMap().onMove([7.3612, 46.2341]));

    await waitFor(() => expect(Number(settings.get('__export_home_lng'))).toBeCloseTo(7.3612, 4));
    expect(Number(settings.get('__export_home_lat'))).toBeCloseTo(46.2341, 4);
    expect(lastMap().home).toEqual([7.3612, 46.2341]);
    // The radius is untouched: moving the home is not turning the trim off.
    expect(settings.get('__export_privacy_radius_m')).toBe('100');
  });

  it('takes a moved pin as the confirmed home, so the switch can then turn on', async () => {
    const { settings } = engineWith();
    const tree = await render(<ExportPrivacyRow />);
    await waitFor(() => expect(tree.getByTestId('export-privacy-map')).toBeTruthy());

    await act(() => lastMap().onMove([7.3612, 46.2341]));
    await fireEvent.press(tree.getByTestId('export-privacy-switch'));

    await waitFor(() => expect(settings.get('__export_privacy_radius_m')).toBe('100'));
    expect(Number(settings.get('__export_home_lat'))).toBeCloseTo(46.2341, 4);
    expect(tree.queryByTestId('export-privacy-confirm')).toBeNull();
  });

  it('draws no map when there is nothing to suggest, rather than one at zero', async () => {
    engineWith({ suggestExportHome: jest.fn(() => null) });
    const tree = await render(<ExportPrivacyRow />);

    await waitFor(() => expect(tree.getByTestId('export-privacy-no-home')).toBeTruthy());
    expect(tree.queryByTestId('export-privacy-map')).toBeNull();
    expect(mapProps).toHaveLength(0);
  });
});
