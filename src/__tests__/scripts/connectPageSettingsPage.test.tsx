/**
 * Scenario: the athlete opens the settings page in the browser against a phone
 * that holds a profile, a sync state and detection settings.
 *
 * Expected behaviour: the page shows each value through the page's own words,
 * never the engine's key (`meters`, `idle`); a strictness edit is sent as
 * `detection.setStrictness` with the other strictness field as the phone
 * holds it; a file-pick control is the kit's button, not a bare file input.
 */

import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';

import { SettingsPage } from '../../../web/connect/pages/Settings';
import { fakePhone } from '../__shared__/connectPhone';

const DETECTION = {
  enabled: true,
  strictness: { minMatchPct: 80, endpointThreshold: 200 },
  sectionConfig: {
    proximityThreshold: 50,
    minSectionLength: 200,
    maxSectionLength: 5000,
    minActivities: 3,
    divergenceThreshold: 30,
  },
};

function answer(method: string) {
  switch (method) {
    case 'settings.get':
      return {
        values: [
          { key: 'veloq-unit-preference', value: 'metric' },
          { key: 'veloq-theme-preference', value: 'system' },
          { key: 'veloq-primary-sport', value: 'Cycling' },
          { key: 'veloq-language-preference', value: 'en-GB' },
        ],
      };
    case 'settings.profile':
      return { name: 'Sam', measurementPreference: 'meters', weightKg: 70 };
    case 'status.sync':
      return { state: 'idle' };
    case 'status.coverage':
      return { upstream: 10, fetched: 9, tracksUpstream: 10, tracksStored: 8 };
    case 'status.cache':
      return { streamStoreBytes: 2_000_000 };
    case 'detection.settings':
      return DETECTION;
    case 'settings.thresholds':
      return THRESHOLDS;
    case 'detection.setStrictness':
      return {};
    default:
      return {};
  }
}

const THRESHOLDS = {
  sports: [
    {
      sport: 'Ride',
      hrZones: { upper: [120, 140, 155, 170, 185], source: 'sportSettings' },
      powerZones: [55, 75, 90, 105, 120, 150, 999],
      figures: [
        { field: 'ftp', value: 240, source: 'file' },
        { field: 'thresholdHr', value: 165, source: 'sportSettings' },
        { field: 'maxHr', value: 190, source: 'athlete' },
        { field: 'restingHr', value: null, source: null },
        { field: 'weightKg', value: 70, source: 'sportSettings' },
      ],
    },
    {
      sport: 'Run',
      hrZones: { upper: [60, 70, 80, 90, 100], source: 'default' },
      powerZones: [],
      figures: [
        { field: 'ftp', value: null, source: null },
        { field: 'thresholdHr', value: 170, source: 'file' },
        { field: 'maxHr', value: 192, source: 'file' },
        { field: 'restingHr', value: 48, source: 'file' },
        { field: 'weightKg', value: null, source: null },
      ],
    },
  ],
  hrZoneDefaultPercents: [60, 70, 80, 90, 100],
};

const session = { importArchive: async () => undefined } as never;
const snapshot = { upload: null, libraryExport: null, writeNotice: null } as never;

async function settle() {
  for (let at = 0; at < 8; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function leaves(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string[] {
  if (node === null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(leaves);
  return (node.children ?? []).flatMap((child) => leaves(child));
}

async function render(id: string | null) {
  const phone = fakePhone(answer);
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      phone.wrap(<SettingsPage session={session} snapshot={snapshot} route={{ id } as never} />)
    );
  });
  await settle();
  return { phone, root };
}

describe('the settings page', () => {
  it('shows no raw engine key as a value', async () => {
    const { root } = await render(null);
    const shown = leaves(root.toJSON());
    expect(shown).not.toContain('meters');
    expect(shown).not.toContain('idle');
    expect(shown).toContain('Sam');
    root.unmount();
  });

  it('sends detection.setStrictness for an edited strictness value', async () => {
    const { phone, root } = await render('detection-settings');
    const field = root.root.findByProps({ id: 'detection-minMatchPct' });
    await act(async () => {
      field.props.onChange('90');
    });
    await act(async () => {
      root.root.findByProps({ id: 'detection-minMatchPct' }).props.onBlur();
    });
    await settle();
    expect(phone.callsOf('detection.setStrictness')).toEqual([
      {
        method: 'detection.setStrictness',
        params: { minMatchPct: 90, endpointThreshold: 200 },
      },
    ]);
    root.unmount();
  });

  it('draws the import file pick through the kit, with no bare file input in the page', async () => {
    const { root } = await render(null);
    const bare = root.root.findAll(
      (node) =>
        node.type === 'input' && node.props.type === 'file' && node.props.id === 'import-file'
    );
    // The input is the kit's visually hidden one, labelled by its button.
    expect(bare.every((node) => node.props.hidden === true || node.props.tabIndex === -1)).toBe(
      true
    );
    expect(root.root.findAllByProps({ id: 'import-file-choose' }).length).toBeGreaterThan(0);
    root.unmount();
  });

  describe('the thresholds table', () => {
    it('shows each figure with the source it came from, in the page words', async () => {
      const { root } = await render('thresholds-settings');
      const shown = leaves(root.toJSON());
      expect(shown).toContain('connectPage.settings.thresholds.source.sportSettings');
      expect(shown).toContain('connectPage.settings.thresholds.source.file');
      expect(shown).toContain('connectPage.settings.thresholds.source.athlete');
      for (const raw of ['file', 'sportSettings', 'athlete']) expect(shown).not.toContain(raw);
      const ftp = root.root.findByProps({ id: 'threshold-Ride-ftp' });
      expect(ftp.props.value).toBe('240');
      expect(root.root.findByProps({ id: 'threshold-Ride-restingHr' }).props.value).toBe('');
      root.unmount();
    });

    it('shows each sport its own zone edges, the default only where sport settings list none', async () => {
      const { root } = await render('thresholds-settings');
      const rows = (id: string) =>
        root.root.findByProps({ id }).findAllByProps({ 'data-zone': true });
      expect(rows('settings-zones-Ride')).toHaveLength(5);
      expect(rows('settings-zones-Run')).toHaveLength(5);
      const shown = leaves(root.toJSON());
      expect(shown).toContain('connectPage.settings.thresholds.source.default');
      expect(shown).toContain('connectPage.settings.thresholds.source.sportSettings');
      expect(root.root.findAllByProps({ 'data-power-zone': true })).toHaveLength(7);
      expect(root.root.findAllByProps({ id: 'settings-power-zones-Run' })).toHaveLength(0);
      root.unmount();
    });

    it('sends settings.setThreshold for an edited figure and nothing for an unchanged one', async () => {
      const { phone, root } = await render('thresholds-settings');
      await act(async () => {
        root.root.findByProps({ id: 'threshold-Ride-ftp' }).props.onChange('255');
      });
      await act(async () => {
        root.root.findByProps({ id: 'threshold-Ride-ftp' }).props.onBlur();
      });
      await settle();
      expect(phone.callsOf('settings.setThreshold')).toEqual([
        {
          method: 'settings.setThreshold',
          params: { sport: 'Ride', field: 'ftp', value: 255 },
        },
      ]);

      await act(async () => {
        root.root.findByProps({ id: 'threshold-Run-maxHr' }).props.onBlur();
      });
      await settle();
      expect(phone.callsOf('settings.setThreshold')).toHaveLength(1);
      root.unmount();
    });

    it('refuses a figure the engine would refuse and shows why, with no write', async () => {
      const { phone, root } = await render('thresholds-settings');
      await act(async () => {
        root.root.findByProps({ id: 'threshold-Ride-ftp' }).props.onChange('-4');
      });
      await act(async () => {
        root.root.findByProps({ id: 'threshold-Ride-ftp' }).props.onBlur();
      });
      await settle();
      expect(phone.callsOf('settings.setThreshold')).toHaveLength(0);
      expect(root.root.findByProps({ id: 'threshold-notice' }).props.role).toBe('alert');
      root.unmount();
    });

    it("clears a figure the athlete set from the source cell's button", async () => {
      const { phone, root } = await render('thresholds-settings');
      expect(root.root.findAllByProps({ id: 'threshold-clear-Ride-ftp' })).toHaveLength(0);
      await act(async () => {
        root.root.findByProps({ id: 'threshold-clear-Ride-maxHr' }).props.onClick();
      });
      await settle();
      expect(phone.callsOf('settings.setThreshold')).toEqual([
        {
          method: 'settings.setThreshold',
          params: { sport: 'Ride', field: 'maxHr', value: null },
        },
      ]);
      root.unmount();
    });
  });

  describe('the display settings', () => {
    it('sends settings.set for a changed choice, and the control is enabled', async () => {
      const { phone, root } = await render('display-settings');
      const select = root.root.findByProps({ id: 'setting-veloq-theme-preference' });
      expect(select.props.disabled).toBeFalsy();
      await act(async () => {
        select.props.onChange('dark');
      });
      await settle();
      expect(phone.callsOf('settings.set')).toEqual([
        {
          method: 'settings.set',
          params: { key: 'veloq-theme-preference', value: 'dark' },
        },
      ]);
      root.unmount();
    });

    it('keeps a setting the page cannot offer choices for read-only', async () => {
      const { phone, root } = await render('display-settings');
      expect(root.root.findAllByProps({ id: 'setting-veloq-language-preference' })).toHaveLength(0);
      expect(leaves(root.toJSON())).toContain('en-GB');
      expect(phone.callsOf('settings.set')).toHaveLength(0);
      root.unmount();
    });
  });
});
