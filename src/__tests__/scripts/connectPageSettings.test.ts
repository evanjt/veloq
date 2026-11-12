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
  PANE_BODY,
  PANE_NOTE,
  SETTINGS_GROUPS,
  pane,
} from '../../../web/connect/settings';

describe('settings pane', () => {
  it('opens a screen the page reads as its readable form', () => {
    expect(pane('display-settings')).toEqual({
      kind: 'readable',
      title: 'Display',
      note: PANE_NOTE,
      body: PANE_BODY,
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
