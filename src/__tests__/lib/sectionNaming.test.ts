import {
  generateSectionName,
  resolveSectionNames,
  splitSectionName,
} from '@/features/routes/lib/sectionNaming';

// Mock resolveIsMetric to return true (metric)
jest.mock('@/shared/app/UnitPreferenceStore', () => ({
  resolveIsMetric: jest.fn(() => true),
}));

// Mock i18n.t to interpolate keys like the real implementation
jest.mock('@/i18n', () => ({
  i18n: {
    t: jest.fn((key: string, opts?: Record<string, string>) => {
      if (key === 'sections.autoName' && opts) {
        return `${opts.sport} Section (${opts.distance})`;
      }
      if (key === 'sections.autoNameClimb' && opts) return `Climb ${opts.distance} ${opts.grade}`;
      if (key === 'sections.autoNameDescent' && opts) {
        return `Descent ${opts.distance} ${opts.grade}`;
      }
      if (key === 'sections.autoNameLoop' && opts) return `Loop ${opts.distance}`;
      if (key === 'sections.splitName' && opts) return `${opts.parent} (${opts.part})`;
      if (key === 'sections.splitOrdinal' && opts) return `${opts.parent} ${opts.n}`;
      const cardinals: Record<string, string> = {
        'sections.splitNorth': 'north',
        'sections.splitEast': 'east',
        'sections.splitSouth': 'south',
        'sections.splitWest': 'west',
      };
      return cardinals[key] ?? key;
    }),
  },
}));

describe('generateSectionName', () => {
  it('leads with the terrain when the engine classed the line', () => {
    expect(
      generateSectionName({
        id: 's',
        sportType: 'Ride',
        distanceMeters: 2300,
        klass: 'climb',
        maxGradePercent: 5.44,
      })
    ).toBe('Climb 2.3 km 5.4%');
    expect(
      generateSectionName({
        id: 's',
        sportType: 'Ride',
        distanceMeters: 4100,
        klass: 'descent',
        maxGradePercent: 8,
      })
    ).toBe('Descent 4.1 km 8.0%');
    expect(
      generateSectionName({ id: 's', sportType: 'Run', distanceMeters: 4100, klass: 'loop' })
    ).toBe('Loop 4.1 km');
    // A climb without a usable grade, or flat ground, falls back to sport and distance.
    expect(
      generateSectionName({ id: 's', sportType: 'Run', distanceMeters: 4100, klass: 'climb' })
    ).toBe('Run Section (4.1 km)');
    expect(
      generateSectionName({ id: 's', sportType: 'Run', distanceMeters: 4100, klass: 'flat' })
    ).toBe('Run Section (4.1 km)');
  });

  it('prefers a present name, else auto-generates by sport and distance', () => {
    const cases: [Parameters<typeof generateSectionName>[0], string][] = [
      [
        { id: 'sec1', name: 'Alpe du Zwift', sportType: 'Ride', distanceMeters: 12000 },
        'Alpe du Zwift',
      ],
      // Non-empty name wins even with zero distance.
      [{ id: 'sec4', name: 'Custom Name', sportType: 'Ride', distanceMeters: 0 }, 'Custom Name'],
      [{ id: 'sec2', sportType: 'Run', distanceMeters: 5000 }, 'Run Section (5.0 km)'],
      // Short sections use meters.
      [{ id: 'sec3', sportType: 'Ride', distanceMeters: 500 }, 'Ride Section (500 m)'],
      // Empty string is falsy, so it auto-generates.
      [{ id: 'sec5', name: '', sportType: 'Walk', distanceMeters: 2500 }, 'Walk Section (2.5 km)'],
    ];

    for (const [input, expected] of cases) {
      expect(generateSectionName(input)).toBe(expected);
    }
  });
});

describe('splitSectionName', () => {
  it('reads a cardinal in-locale and an ordinal as a number', () => {
    expect(splitSectionName('Col de la Croix', 'north')).toBe('Col de la Croix (north)');
    expect(splitSectionName('Col de la Croix', '2')).toBe('Col de la Croix 2');
  });
});

describe('resolveSectionNames', () => {
  const own = { trunk: 'Morning Berg', a: 'Ride Section (1.0 km)', b: 'Ride Section (800 m)' };

  it('composes a sibling from its parent and leaves the rest alone', () => {
    const names = resolveSectionNames(own, [
      { sectionId: 'a', parentId: 'trunk', discriminator: 'east' },
    ]);
    expect(names).toEqual({ ...own, a: 'Morning Berg (east)' });
  });

  it('resolves a sibling of a sibling through the chain', () => {
    const names = resolveSectionNames(own, [
      { sectionId: 'a', parentId: 'trunk', discriminator: 'east' },
      { sectionId: 'b', parentId: 'a', discriminator: '2' },
    ]);
    expect(names.b).toBe('Morning Berg (east) 2');
  });

  it('falls back to the own name when the parent is unknown or the chain loops', () => {
    expect(
      resolveSectionNames(own, [{ sectionId: 'a', parentId: 'gone', discriminator: 'north' }]).a
    ).toBe(own.a);
    const looped = resolveSectionNames(own, [
      { sectionId: 'a', parentId: 'b', discriminator: 'north' },
      { sectionId: 'b', parentId: 'a', discriminator: 'south' },
    ]);
    expect(looped.a).toBe(own.a);
    expect(looped.b).toBe(own.b);
  });
});
