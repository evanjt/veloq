import { LIBERTY_STYLE } from '@/features/maps/styles/liberty';
import { DARK_MATTER_STYLE } from '@/features/maps/components/darkMatterStyle';

// Scenario: a label that reads name:nonlatin makes the renderer fetch glyph ranges for scripts
// no label on screen uses. Expected behaviour: no label reads it, and a place with no English
// name still falls back to its local name.
type Layer = { id: string; layout?: Record<string, unknown> };
const textFields = (style: { layers: readonly unknown[] }) =>
  (style.layers as Layer[])
    .filter((l) => l.layout && l.layout['text-field'] !== undefined)
    .map((l) => ({ id: l.id, field: l.layout!['text-field'] }));

describe.each([
  ['liberty', LIBERTY_STYLE],
  ['dark matter', DARK_MATTER_STYLE],
])('%s label layers', (_name, style) => {
  const fields = textFields(style);

  it('has label layers to check', () => {
    expect(fields.length).toBeGreaterThan(0);
  });

  it('never reads name:nonlatin', () => {
    const offenders = fields.filter((f) => JSON.stringify(f.field).includes('nonlatin'));
    expect(offenders.map((o) => o.id)).toEqual([]);
  });
});

describe('liberty text-field fallback', () => {
  it('uses the English name, then the local name', () => {
    const named = textFields(LIBERTY_STYLE).filter((f) =>
      JSON.stringify(f.field).includes('name_en')
    );
    expect(named.length).toBeGreaterThan(0);
    for (const f of named) {
      expect(f.field).toEqual(['coalesce', ['get', 'name_en'], ['get', 'name']]);
    }
  });
});
