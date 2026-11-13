/**
 * Scenario: a reader checks one locale's accepted identical values and the
 * translations it has changed since a revision, from a sheet printed off the
 * bundles and the accepted list as they stand.
 *
 * Expected behaviour: every accepted key appears with the locale value, the
 * en-US value and its reason; every key whose value differs from the earlier
 * bundle appears with both values, every key the earlier bundle lacked appears
 * as new, and nothing unchanged is listed.
 */

const {
  reviewSheet,
  leaves,
  resolvedBundle,
} = require('../../../scripts/lib/translation-review.js');

const reference = {
  garden: { trowel: 'Trowel', compost: 'Compost', hedge: 'Hedge', label: 'Plot | {{n}}' },
  greenhouse: { title: 'Greenhouse', vents: 'Vents' },
};

const before = {
  garden: { trowel: 'Truelle', compost: 'Compost', hedge: 'Haie', label: 'Plot | {{n}}' },
  greenhouse: { title: 'Serre', vents: 'Vents' },
};

const current = {
  garden: { trowel: 'Transplantoir', compost: 'Compost', hedge: 'Haie', label: 'Plot | {{n}}' },
  greenhouse: { title: 'Serre', vents: 'Aérations', shade: 'Ombrage' },
};

const accepted = {
  'garden.compost': 'Same word in this language.',
  'garden.label': 'Placeholder only around a symbol.',
};

function sheet(overrides: Record<string, unknown> = {}) {
  return reviewSheet({
    locale: 'fr',
    since: 'abc1234',
    reference,
    before,
    current,
    accepted,
    ...overrides,
  });
}

describe('leaves', () => {
  it('flattens nested bundles to dotted keys and skips non-string values', () => {
    expect(leaves({ a: { b: 'x', c: { d: 'y' } }, e: 3 })).toEqual(
      new Map([
        ['a.b', 'x'],
        ['a.c.d', 'y'],
      ])
    );
  });
});

describe('reviewSheet', () => {
  it('lists each accepted key with its locale value, en-US value and reason', () => {
    const text = sheet();
    expect(text).toContain('| garden.compost | Compost | Compost | Same word in this language. |');
    expect(text).toContain(
      '| garden.label | Plot \\| {{n}} | Plot \\| {{n}} | Placeholder only around a symbol. |'
    );
  });

  it('lists every value changed since the earlier bundle with both values and nothing unchanged', () => {
    const text = sheet();
    expect(text).toContain('| garden.trowel | Truelle | Transplantoir | Trowel |');
    expect(text).toContain('| greenhouse.vents | Vents | Aérations | Vents |');
    expect(text).not.toContain('| garden.hedge |');
    expect(text).not.toContain('| greenhouse.title |');
  });

  it('lists a key the earlier bundle lacked under new translations, not changed ones', () => {
    const text = sheet();
    const [changed, added] = text.split('## New translations');
    expect(added).toContain('| greenhouse.shade | Ombrage |  |');
    expect(changed).not.toContain('greenhouse.shade');
  });

  it('counts the entries a reader reads, so the reading can be recorded', () => {
    expect(sheet()).toContain(
      '2 accepted identical values, 2 changed translations and 1 new translations since abc1234.'
    );
  });

  it('marks an accepted key whose value no longer matches en-US', () => {
    const text = sheet({
      current: { ...current, garden: { ...current.garden, compost: 'Terreau' } },
    });
    expect(text).toContain('| garden.compost | Terreau | Compost | Same word in this language. |');
    expect(text).toContain('no longer identical');
  });

  it('says so when the locale has no accepted values and no changes', () => {
    const text = sheet({ before: current, accepted: {} });
    expect(text).toContain('0 accepted identical values, 0 changed translations and 0 new');
    expect(text.match(/^None\.$/gm)).toHaveLength(3);
  });

  it('treats a locale absent at the earlier revision as wholly added', () => {
    const text = sheet({ before: {} });
    expect(text).toContain('| greenhouse.title | Serre | Greenhouse |');
    expect(text).toContain('0 changed translations and 7 new translations');
  });

  it('keeps a value with a line break on one table row', () => {
    const text = sheet({
      current: { ...current, greenhouse: { ...current.greenhouse, vents: 'Aérations\nhautes' } },
    });
    expect(text).toContain('| greenhouse.vents | Vents | Aérations<br>hautes | Vents |');
  });
});

describe('resolvedBundle', () => {
  const bundles: Record<string, Record<string, unknown>> = {
    'en-US': { garden: { hedge: 'Hedge' }, greenhouse: { title: 'Greenhouse' } },
    'en-GB': {
      garden: { hedge: 'Hedge', trowel: 'Trowel' },
      greenhouse: { title: 'Glasshouse', vents: 'Vents' },
    },
  };
  const load = (name: string) => bundles[name];

  it('fills a key the first bundle lacks from the next one in the chain', () => {
    expect(resolvedBundle(['en-US', 'en-GB'], load)).toEqual({
      garden: { hedge: 'Hedge', trowel: 'Trowel' },
      greenhouse: { title: 'Greenhouse', vents: 'Vents' },
    });
  });

  it('reads a chain entry with no bundle as holding nothing', () => {
    expect(resolvedBundle(['en-US', 'missing', 'en-GB'], load)).toEqual(
      resolvedBundle(['en-US', 'en-GB'], load)
    );
  });

  it('returns the first bundle unchanged when the chain has one entry', () => {
    expect(resolvedBundle(['en-US'], load)).toEqual(bundles['en-US']);
  });
});
