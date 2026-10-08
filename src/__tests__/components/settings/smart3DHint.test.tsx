/**
 * Scenario: an athlete meets the 3D terrain choice on the map tour slide or
 * in the Maps settings and has to guess what Smart does.
 *
 * Expected behaviour: both surfaces say, in the athlete's units, that Smart
 * draws feed cards and activity maps in 3D on its own once the route spans the
 * height the rule itself tests, so the copy and the rule cannot drift apart.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { resolveTerrain3D, SMART_3D_MIN_RELIEF_M } from '@/features/maps/lib/cameraAngle';
import { MapPreferencesProvider, useMapPreferences } from '@/features/settings';
import { MapsSection } from '@/features/settings/components/MapsSection';
import { MapPreferencesSlide } from '@/features/settings/components/whatsNew/MapPreferencesSlide';
import { SUPPORTED_LOCALES } from '@/i18n';
import { formatElevation } from '@/shared/format/format';
import { resolvedLocale } from '../../i18n/resolvedLocale';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

let mockIsMetric = true;
jest.mock('@/shared/app/useMetricSystem', () => ({
  useMetricSystem: () => mockIsMetric,
}));

jest.mock('@/features/settings/components/MapStylePreviewPicker', () => ({
  MapStylePreviewPicker: () => null,
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, values?: unknown) =>
      typeof values === 'object' && values !== null && 'height' in values
        ? `[${key}|${String((values as { height: unknown }).height)}]`
        : `[${key}]`,
  }),
}));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => undefined),
  removeSetting: jest.fn(async () => undefined),
}));

function Gate({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useMapPreferences();
  return isLoaded ? <>{children}</> : null;
}

function surface(node: React.ReactNode) {
  return render(
    <MapPreferencesProvider>
      <Gate>{node}</Gate>
    </MapPreferencesProvider>
  );
}

/** A straight 2 km track whose altitude climbs `relief` metres end to end. */
function track(relief: number) {
  const coordinates: [number, number][] = [];
  const altitude: number[] = [];
  for (let i = 0; i <= 20; i++) {
    coordinates.push([6.6 + i * 0.001, 46.5 + i * 0.0005]);
    altitude.push(400 + (relief * i) / 20);
  }
  return { coordinates, altitude };
}

describe('the smart 3D threshold', () => {
  it('turns 3D on at the quoted height and leaves it off just below', () => {
    const at = track(SMART_3D_MIN_RELIEF_M);
    const below = track(SMART_3D_MIN_RELIEF_M - 1);
    const base = { mode: 'smart' as const, gain: 0, distance: 2000, override: null };

    expect(resolveTerrain3D({ ...base, ...at }).show3D).toBe(true);
    expect(resolveTerrain3D({ ...base, ...below }).show3D).toBe(false);
  });

  it('asks the same gain of an activity whose altitude has not loaded', () => {
    const base = { mode: 'smart' as const, coordinates: [], altitude: undefined, override: null };

    expect(resolveTerrain3D({ ...base, gain: SMART_3D_MIN_RELIEF_M, distance: 2000 }).show3D).toBe(
      true
    );
    expect(
      resolveTerrain3D({ ...base, gain: SMART_3D_MIN_RELIEF_M - 1, distance: 2000 }).show3D
    ).toBe(false);
  });
});

describe.each([
  ['metric', true],
  ['imperial', false],
])('the smart 3D hint in %s units', (_units, isMetric) => {
  beforeEach(() => {
    mockIsMetric = isMetric;
  });

  const expected = () =>
    `[settings.terrain3DSmartHint|${formatElevation(SMART_3D_MIN_RELIEF_M, isMetric)}]`;

  it('is drawn in the Maps settings', async () => {
    const tree = surface(<MapsSection />);
    expect(await tree.findByText(expected())).toBeTruthy();
  });

  it('is drawn on the map tour slide', async () => {
    const tree = surface(<MapPreferencesSlide />);
    expect(await tree.findByText(expected())).toBeTruthy();
  });
});

describe('the smart 3D hint string', () => {
  it.each(SUPPORTED_LOCALES.map((l) => [l]))('exists in %s and takes the height', (locale) => {
    const settings = (resolvedLocale(locale) as unknown as Record<string, Record<string, string>>)
      .settings;
    expect(settings.terrain3DSmartHint).toContain('{{height}}');
  });
});
