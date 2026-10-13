import { convertLegacyBackupToRecord } from '@/features/settings/lib/backup';

const legacy = {
  version: 2,
  exportedAt: '2026-01-01',
  appVersion: '0.3.0',
  customSections: [
    {
      name: 'Hill',
      sportType: 'Ride',
      sourceActivityId: 'old-ride',
      startIndex: 12,
      endIndex: 48,
    },
  ],
  sectionNames: { oldSection: 'Climb' },
  routeNames: { oldRoute: 'Loop' },
  preferences: { 'veloq-theme-preference': 'dark', 'veloq-push-token-refreshed-at': 'stale' },
};

describe('legacy record conversion', () => {
  it.each([1, 2])('preserves version %i decisions for record restore', (version) => {
    const record = convertLegacyBackupToRecord(JSON.stringify({ ...legacy, version }));

    expect(record.version).toBe(1);
    expect(record.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'sections',
          ground: expect.objectContaining({
            rep_activity_id: 'old-ride',
            rep_start_index: 12,
            rep_end_index: 49,
          }),
        }),
        expect.objectContaining({
          table: 'legacy_section_name',
          values: expect.objectContaining({ section_id: 'oldSection', name: 'Climb' }),
        }),
        expect.objectContaining({
          table: 'route_names',
          values: expect.objectContaining({ route_id: 'oldRoute', custom_name: 'Loop' }),
        }),
        expect.objectContaining({
          table: 'settings',
          values: expect.objectContaining({ key: 'veloq-theme-preference', value: 'dark' }),
        }),
      ])
    );
    expect(record.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({ key: 'veloq-push-token-refreshed-at' }),
        }),
      ])
    );
  });

  it('turns the inclusive end the old writer exported into a half-open ground', () => {
    // The old restore refused an endIndex at the track length, so the end was the last point.
    const [section] = convertLegacyBackupToRecord(
      JSON.stringify({
        version: 2,
        customSections: [{ ...legacy.customSections[0], endIndex: 13 }],
      })
    ).entries;
    expect(section.ground).toMatchObject({ rep_start_index: 12, rep_end_index: 14 });
  });

  it('refuses malformed decisions and newer versions before producing a record', () => {
    expect(() => convertLegacyBackupToRecord('null')).toThrow('Corrupt backup');
    expect(() => convertLegacyBackupToRecord(JSON.stringify({ ...legacy, version: 3 }))).toThrow(
      'Unsupported backup version'
    );
    expect(() =>
      convertLegacyBackupToRecord(
        JSON.stringify({
          ...legacy,
          customSections: [{ ...legacy.customSections[0], endIndex: 4 }],
        })
      )
    ).toThrow('Corrupt backup');
  });

  it('accepts an empty version 1 record without inventing decisions', () => {
    const record = convertLegacyBackupToRecord(JSON.stringify({ version: 1 }));
    expect(record.entries).toEqual([]);
  });

  it('records an unnamed custom section with no name, not an empty one', () => {
    const unnamed = { ...legacy, customSections: [{ ...legacy.customSections[0], name: '' }] };
    const record = convertLegacyBackupToRecord(JSON.stringify(unnamed));
    const section = record.entries.find((e) => e.table === 'sections');

    expect(section?.values.name).toBeNull();
  });

  it('does not carry preference keys whose readers no longer exist', () => {
    const record = convertLegacyBackupToRecord(
      JSON.stringify({
        ...legacy,
        preferences: {
          'veloq-theme-preference': 'dark',
          'veloq-section-dismissals': '["a"]',
          'veloq-disabled-sections': '["d"]',
          'veloq-superseded-sections': '["s"]',
          'veloq-geocoded-route-ids': '["r"]',
          'veloq-geocoded-section-ids': '["s"]',
        },
      })
    );
    const keys = record.entries
      .filter((entry) => entry.table === 'settings')
      .map((entry) => entry.values.key);

    expect(keys).toEqual(['veloq-theme-preference']);
  });

  it("leaves this install's upload grant out of a converted backup", () => {
    const record = convertLegacyBackupToRecord(
      JSON.stringify({
        ...legacy,
        preferences: {
          'veloq-theme-preference': 'dark',
          'veloq-upload-permission': '{"hasWritePermission":true}',
        },
      })
    );
    const keys = record.entries
      .filter((entry) => entry.table === 'settings')
      .map((entry) => entry.values.key);

    expect(keys).toEqual(['veloq-theme-preference']);
  });

  it('carries each disabled and superseded id as its own unplaced record', () => {
    const record = convertLegacyBackupToRecord(
      JSON.stringify({
        ...legacy,
        preferences: {
          'veloq-disabled-sections': '["d1","d2"]',
          'veloq-superseded-sections': ['s1'],
        },
      })
    );
    const carried = record.entries
      .filter((entry) => entry.table.startsWith('legacy_section_'))
      .filter((entry) => entry.table !== 'legacy_section_name')
      .map((entry) => [entry.table, entry.values, entry.ground]);

    expect(carried).toEqual([
      ['legacy_section_disabled', { section_id: 'd1' }, null],
      ['legacy_section_disabled', { section_id: 'd2' }, null],
      ['legacy_section_superseded', { section_id: 's1' }, null],
    ]);
    expect(record.entries.some((entry) => entry.table === 'settings')).toBe(false);
  });

  it.each(['not json', '{"a":1}', '[1,""]', 'null'])(
    'ignores an unreadable disabled list %p without failing the import',
    (raw) => {
      const record = convertLegacyBackupToRecord(
        JSON.stringify({ ...legacy, preferences: { 'veloq-disabled-sections': raw } })
      );
      expect(record.entries.some((entry) => entry.table === 'legacy_section_disabled')).toBe(false);
    }
  );
});
