/**
 * Scenario: the connect page's settings address (`#/settings/<screen>`) names
 * one of the phone's settings screens, or one the phone keeps to itself.
 *
 * Expected behaviour: a screen the page reads opens its form on the right, a
 * screen the phone keeps to itself says so and carries no control, and an
 * address that names nothing the phone lists is the page's "not on the
 * browser yet" state. The left list and the right pane are one table, so a
 * row in the list always opens a pane that is not the unknown one.
 */

import {
  ON_THE_PHONE,
  PANE_NOTE,
  SETTINGS_GROUPS,
  pane,
  paneControls,
  readsScreen,
  unitSystem,
} from '../../../web/connect/settings';
import { km, kmh, setUnitSystem } from '../../../web/connect/format';

describe('settings pane', () => {
  it('opens a screen the page reads as its readable form', () => {
    expect(pane('display-settings')).toEqual({
      kind: 'readable',
      title: 'connectPage.settings.rows.display',
      note: PANE_NOTE,
    });
  });

  it('answers a screen the phone keeps to itself with the reason and no controls', () => {
    const result = pane('sensor-settings');

    expect(result.kind).toBe('phone');
    expect(Object.keys(result).sort()).toEqual(['kind', 'title', 'why']);
    if (result.kind === 'phone') expect(result.why.length).toBeGreaterThan(0);
  });

  it('shows the hub when no screen is named and the not-yet state for an unknown one', () => {
    expect(pane(null)).toEqual({ kind: 'hub' });
    expect(pane('')).toEqual({ kind: 'hub' });
    expect(pane('no-such-screen')).toEqual({ kind: 'unknown' });
  });

  it('opens every row the left list shows as a readable pane', () => {
    for (const group of SETTINGS_GROUPS) {
      for (const row of group.rows) {
        expect(pane(row.screen).kind).toBe('readable');
      }
    }
  });

  it('gives every phone-only entry that names a screen a phone pane', () => {
    for (const entry of ON_THE_PHONE) {
      if (entry.screen) expect(pane(entry.screen).kind).toBe('phone');
    }
  });

  it('lists each screen under one place only', () => {
    const screens = [
      ...SETTINGS_GROUPS.flatMap((group) => group.rows.map((row) => row.screen)),
      ...ON_THE_PHONE.flatMap((entry) => (entry.screen ? [entry.screen] : [])),
    ];

    expect(new Set(screens).size).toBe(screens.length);
  });
});

describe('settings pane controls', () => {
  const read = (entries: Record<string, string | null>) => ({
    values: Object.entries(entries).map(([key, value]) => ({ key, value })),
    refused: [],
  });

  it('draws a readable pane from the read as disabled controls with the value shown', () => {
    const controls = paneControls(
      'display-settings',
      read({ 'veloq-theme-preference': 'dark', 'veloq-wellness-smoothing': null })
    );

    const theme = controls.find((control) => control.key === 'veloq-theme-preference');
    expect(theme).toMatchObject({ kind: 'choice', value: 'dark', disabled: true });
    expect(theme?.kind === 'choice' && theme.options.map((option) => option.value)).toEqual([
      'system',
      'light',
      'dark',
    ]);
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((control) => control.disabled)).toBe(true);
  });

  it('shows a setting the phone has not set as unset, not as a made-up value', () => {
    const [control] = paneControls('map-settings', read({ 'veloq-map-preferences': null }));

    expect(control.value).toBeNull();
    expect(control.disabled).toBe(true);
  });

  it('has no controls for a screen the page does not draw from settings', () => {
    expect(paneControls('linked-devices', read({}))).toEqual([]);
    expect(paneControls('sensor-settings', read({}))).toEqual([]);
    expect(paneControls('display-settings', undefined)).toEqual([]);
  });

  it('resolves the unit system from the phone preference, then the profile', () => {
    expect(unitSystem('imperial', undefined)).toBe('imperial');
    expect(unitSystem('metric', 'feet')).toBe('metric');
    expect(unitSystem('auto', 'feet')).toBe('imperial');
    expect(unitSystem(null, 'meters')).toBe('metric');
    expect(unitSystem(null, undefined)).toBe('metric');
  });

  it('reads every readable row, so no pane says it is not read', () => {
    for (const group of SETTINGS_GROUPS) {
      for (const row of group.rows) expect(readsScreen(row.screen)).toBe(true);
    }
  });
});

describe('figures by unit system', () => {
  afterEach(() => setUnitSystem('metric'));

  it('writes distance and speed in miles when the phone says imperial', () => {
    setUnitSystem('imperial');

    expect(km(16093.44)).toBe('10.0 mi');
    expect(kmh(10)).toBe('22.4 mph');
  });

  it('writes kilometres by default and keeps null as null', () => {
    expect(km(10000)).toBe('10.0 km');
    expect(kmh(10)).toBe('36.0 km/h');
    setUnitSystem('imperial');
    expect(km(null)).toBeNull();
  });
});
