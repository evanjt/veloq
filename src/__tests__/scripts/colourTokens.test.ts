/**
 * Scenario: the design system's token file is the one source of every colour,
 * and a generator writes it into the TypeScript palette, the native app colours
 * and the engine's heatmap ramp. A token with a gap, a palette key nobody
 * mapped, or a committed table edited by hand would each draw a colour nobody
 * chose.
 *
 * Expected behaviour: resolution refuses a gap, the outputs are exactly what
 * the token file says, and the check names every drift.
 */

import {
  checkColourRoles,
  renderAppColours,
  renderRustHeatRamp,
  renderTypeScript,
  resolveColourTokens,
  roleColours,
  staleOutputs,
  type RoleMap,
  type TokenFile,
} from '@/../scripts/lib/colourTokens';

const fixture = (tokens: TokenFile['color']['tokens']): TokenFile => ({
  color: { themes: [{ id: 'light' }, { id: 'dark' }], tokens },
});

const FILE = fixture([
  { name: 'ink-100', value: { light: '#eff1f4', dark: '#eff1f4' } },
  { name: 'ink-900', value: { light: '#171b22', dark: '#171b22' } },
  { name: 'text-body', value: { light: '{ink-900}', dark: '{ink-100}' } },
  { name: 'heat-1', value: { light: '#2d7bde', dark: '#2d7bde' } },
  { name: 'heat-2', value: { light: '#ddebff', dark: '#ddebff' } },
  { name: 'hover', value: { light: 'rgba(23,27,34,0.04)', dark: 'rgba(239, 241, 244, .06)' } },
  { name: 'later-1', value: { light: '#000', dark: '#fff' } },
]);

const HEAT = [
  { intensity: 0.04, token: 'heat-1', alpha: 176 },
  { intensity: 1, token: 'heat-2', alpha: 248 },
];

const MAP: RoleMap = {
  keys: {
    textPrimary: { role: 'text-body', from: ['light', 'dark'] },
    tint: { role: 'hover' },
    oldCyan: { drop: 'no reader' },
  },
  reserved: { 'later-*': 'kept for a reader to come' },
};

const PALETTES = {
  light: { textPrimary: '#171B22', tint: 'rgba(0, 0, 0, 0.02)', oldCyan: '#06B6D4' },
  dark: { textPrimary: '#EFF1F4', tint: 'rgba(255, 255, 255, 0.05)' },
};

describe('resolving the token file', () => {
  it('follows aliases in each theme and writes one spelling', () => {
    const resolved = resolveColourTokens(FILE);

    expect(resolved.light['text-body']).toBe('#171B22');
    expect(resolved.dark['text-body']).toBe('#EFF1F4');
    expect(resolved.light['later-1']).toBe('#000000');
    expect(resolved.dark.hover).toBe('rgba(239, 241, 244, 0.06)');
  });

  it('refuses a token with no dark value, naming it', () => {
    const gap = fixture([{ name: 'record', value: { light: '#c1121f' } }]);
    expect(() => resolveColourTokens(gap)).toThrow('token record has no dark value');
  });

  it('refuses an alias whose target has no value in that theme', () => {
    const gap = fixture([
      { name: 'base', value: { light: '#ffffff' } },
      { name: 'surface', value: { light: '{base}', dark: '{base}' } },
    ]);
    expect(() => resolveColourTokens(gap)).toThrow('base has no dark value');
  });

  it('refuses an alias to nothing, a cycle and a value that is not a colour', () => {
    expect(() =>
      resolveColourTokens(fixture([{ name: 'a', value: { light: '{b}', dark: '#000' } }]))
    ).toThrow('aliases {b}, which is not a token');
    expect(() =>
      resolveColourTokens(
        fixture([
          { name: 'a', value: { light: '{b}', dark: '#000' } },
          { name: 'b', value: { light: '{a}', dark: '#000' } },
        ])
      )
    ).toThrow('cycle');
    expect(() =>
      resolveColourTokens(fixture([{ name: 'a', value: { light: 'teal', dark: '#000' } }]))
    ).toThrow('not a colour');
  });
});

describe('the generated outputs', () => {
  const resolved = resolveColourTokens(FILE);

  it('writes the engine heatmap ramp from the tokens, transparent stop first', () => {
    expect(renderRustHeatRamp(resolved, HEAT)).toContain(
      [
        'pub(crate) const HEATMAP_STOPS: &[(f32, f32, f32, f32, f32)] = &[',
        '    (0.0, 0.0, 0.0, 0.0, 0.0),',
        '    (0.04, 45.0, 123.0, 222.0, 176.0),',
        '    (1.0, 221.0, 235.0, 255.0, 248.0),',
        '];',
      ].join('\n')
    );
  });

  it('refuses a heatmap stop out of order or on a translucent token', () => {
    expect(() =>
      renderRustHeatRamp(resolved, [
        { intensity: 0.5, token: 'heat-1', alpha: 176 },
        { intensity: 0.2, token: 'heat-2', alpha: 248 },
      ])
    ).toThrow('out of order');
    expect(() =>
      renderRustHeatRamp(resolved, [{ intensity: 0.5, token: 'hover', alpha: 176 }])
    ).toThrow('opaque hex');
  });

  it('writes the TypeScript tables the palette and the heatmap key read', () => {
    const ts = renderTypeScript(resolved, roleColours(resolved, MAP), HEAT);

    expect(ts).toContain("    'text-body': '#171B22',");
    expect(ts).toContain("    'text-body': '#EFF1F4',");
    expect(ts).toContain("    textPrimary: '#171B22',");
    expect(ts).toContain("    textPrimary: '#EFF1F4',");
    expect(ts).not.toContain('tint:');
    expect(ts).toContain('  { intensity: 0.04, rgba: [45, 123, 222, 176] },');
  });

  it('writes the native app colours from their tokens', () => {
    expect(JSON.parse(renderAppColours(resolved, { appColour: 'heat-1' }))).toEqual({
      appColour: '#2D7BDE',
    });
    expect(() => renderAppColours(resolved, { appColour: 'gone' })).toThrow('not a token');
  });
});

describe('checking the role map against the palette', () => {
  const resolved = resolveColourTokens(FILE);
  const readers = ['heat-1', 'heat-2'];

  it('passes a palette every key of which is mapped or dropped', () => {
    expect(checkColourRoles(FILE, resolved, MAP, PALETTES, readers)).toEqual([]);
  });

  it('names a palette key the map does not account for', () => {
    const palettes = { ...PALETTES, light: { ...PALETTES.light, chartTeal: '#0D9488' } };
    expect(checkColourRoles(FILE, resolved, MAP, palettes, readers)).toEqual([
      'colors key chartTeal is neither mapped to a role nor dropped',
    ]);
  });

  it('names a key that reads a role but carries another value', () => {
    const palettes = { ...PALETTES, dark: { ...PALETTES.dark, textPrimary: '#FAFAFA' } };
    expect(checkColourRoles(FILE, resolved, MAP, palettes, readers)).toEqual([
      'textPrimary in dark is #FAFAFA, not text-body #EFF1F4, so it was overridden',
    ]);
  });

  it('names a role nothing reads and nobody reserved', () => {
    const map = { ...MAP, reserved: {} };
    expect(checkColourRoles(FILE, resolved, map, PALETTES, readers)).toEqual([
      'role later-1 has no reader and is not reserved',
    ]);
  });

  it('names a role that is not a token, and a key listed that the palette lost', () => {
    const map: RoleMap = {
      ...MAP,
      keys: { ...MAP.keys, tint: { role: 'hover-old' }, gone: { drop: 'no reader' } },
    };
    expect(checkColourRoles(FILE, resolved, map, PALETTES, readers)).toEqual([
      'tint folds into hover-old, which is not a token',
      'the role map lists gone, which neither colors nor darkColors has',
      'role hover has no reader and is not reserved',
    ]);
  });

  it('names a key that reads an interface role under a name other than the role', () => {
    const map: RoleMap = {
      ...MAP,
      interface: ['text-body'],
      keys: {
        ...MAP.keys,
        textBody: { role: 'text-body', from: ['light', 'dark'] },
      },
    };
    const palettes = {
      light: { ...PALETTES.light, textBody: '#171B22' },
      dark: { ...PALETTES.dark, textBody: '#EFF1F4' },
    };
    expect(checkColourRoles(FILE, resolved, map, palettes, readers)).toEqual([
      'textPrimary reads the interface role text-body, which the palette names textBody',
    ]);
  });

  it('names an interface role key that keeps a hand value in a theme', () => {
    const map: RoleMap = {
      interface: ['text-body', 'hover'],
      keys: {
        textBody: { role: 'text-body', from: ['light'] },
        tint: { role: 'hover' },
        oldCyan: { drop: 'no reader' },
      },
      reserved: MAP.reserved,
    };
    const palettes = {
      light: { textBody: '#171B22', tint: 'rgba(0, 0, 0, 0.02)', oldCyan: '#06B6D4' },
      dark: { textBody: '#FAFAFA', tint: 'rgba(255, 255, 255, 0.05)' },
    };
    expect(checkColourRoles(FILE, resolved, map, palettes, readers)).toEqual([
      'textBody is the interface role text-body and reads it in light only, not in both themes',
    ]);
  });

  it('lets a key that has not folded yet keep its own name and value', () => {
    const map: RoleMap = { ...MAP, interface: ['hover'] };
    expect(checkColourRoles(FILE, resolved, map, PALETTES, readers)).toEqual([]);
  });

  it('names an interface role that is not a token', () => {
    const map: RoleMap = { ...MAP, interface: ['text-headline'] };
    expect(checkColourRoles(FILE, resolved, map, PALETTES, readers)).toEqual([
      'the interface role text-headline is not a token',
    ]);
  });

  it('names a reservation that matches nothing', () => {
    const map = { ...MAP, reserved: { ...MAP.reserved, 'sport-*': 'for later' } };
    expect(checkColourRoles(FILE, resolved, map, PALETTES, readers)).toEqual([
      'the reservation sport-* matches no token',
    ]);
  });
});

describe('the drift check', () => {
  const expected = {
    'src/theme/colourTokens.generated.ts': 'export const a = 1;\n',
    'src/theme/appColours.json': '{}\n',
  };

  it('passes outputs committed as generated', () => {
    expect(staleOutputs(expected, (path) => expected[path as keyof typeof expected])).toEqual([]);
  });

  it('names an output edited by hand and one never committed', () => {
    const committed: Record<string, string> = {
      'src/theme/colourTokens.generated.ts': 'export const a = 2;\n',
    };
    expect(staleOutputs(expected, (path) => committed[path] ?? null)).toEqual([
      'src/theme/colourTokens.generated.ts',
      'src/theme/appColours.json',
    ]);
  });
});
