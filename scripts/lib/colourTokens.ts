/**
 * The colour token file, resolved, checked and written out to every consumer.
 *
 * `src/theme/tokens.json` is the design system's own token file, committed as
 * it was taken. Each colour token holds a value per theme, either a colour or
 * `{another-token}`. Code cannot read the file directly on every target: the
 * engine is Rust, `app.config.js` runs before the bundle exists, and the
 * palette in `colors.ts` is typed. So one generator resolves it once and writes
 * a table each of them can read, and `--check` refuses a table that has drifted.
 *
 * `src/theme/colourRoles.json` says how the keys of `colors` and `darkColors`
 * relate to the tokens: which role each folds into, in which themes it already
 * reads that role, and which keys are dropped. Its interface roles are read
 * under their own names only, so no role carries a second key. A key the file
 * does not account for, a role nothing reads and nobody reserved, a key that
 * claims a role it no longer matches, or an interface role read under another
 * name all fail the check.
 */

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export interface TokenFile {
  color: {
    themes: { id: string }[];
    tokens: { name: string; value: Partial<Record<string, string>> }[];
  };
}

/** Every colour token's final value in each theme, by name. */
export type ResolvedTokens = Record<Theme, Record<string, string>>;

export interface RoleEntry {
  /** The token the key folds into. */
  role?: string;
  /** Other roles the key's readers split across when it folds. */
  also?: string[];
  /** The themes in which the key is read from `role` now, not hand-written. */
  from?: Theme[];
  /** Why the key goes without a role. */
  drop?: string;
}

export interface RoleMap {
  /**
   * The interface roles, which the palette names its keys after: the key that
   * reads `text-primary` is `textPrimary`, in both themes, and no other key
   * reads it, so a role has one name wherever it is drawn.
   */
  interface?: string[];
  keys: Record<string, RoleEntry>;
  /** Token names, or prefixes ending in `*`, kept for a reader still to come. */
  reserved: Record<string, string>;
}

/**
 * One base map's heatmap tile palette: the five heat steps from fewest passes
 * to most, and the halo the engine draws round the heat, if the base paints one.
 */
export interface HeatPalette {
  base: string;
  steps: readonly string[];
  halo?: string;
}

const ALIAS = /^\{([a-z0-9-]+)\}$/;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+|1\.0+)\s*\)$/;

/** A colour in the one spelling the generated files carry, or null if it is not one. */
export function normaliseColour(value: string): string | null {
  const hex = HEX.exec(value)?.[1];
  if (hex !== undefined) {
    const digits =
      hex.length === 3
        ? hex
            .split('')
            .map((d) => d + d)
            .join('')
        : hex;
    return `#${digits.toUpperCase()}`;
  }
  const rgba = RGBA.exec(value);
  if (rgba) {
    const [, red = '', green = '', blue = '', alpha = ''] = rgba;
    const [r, g, b] = [Number(red), Number(green), Number(blue)];
    if (r > 255 || g > 255 || b > 255) return null;
    return `rgba(${r}, ${g}, ${b}, ${Number(alpha)})`;
  }
  return null;
}

/**
 * Every token's value in both themes, aliases followed. Throws on the first
 * token with no value in a theme, an alias to nothing, an alias cycle or a
 * value that is not a colour, because a table written around a gap draws
 * something nobody chose.
 */
export function resolveColourTokens(file: TokenFile): ResolvedTokens {
  const themes = file.color.themes.map((t) => t.id).sort();
  if (themes.join() !== [...THEMES].sort().join()) {
    throw new Error(`the token file's themes are ${themes.join(', ')}, not light and dark`);
  }
  const raw = new Map<string, Partial<Record<string, string>>>();
  for (const token of file.color.tokens) {
    if (raw.has(token.name)) throw new Error(`token ${token.name} is defined twice`);
    raw.set(token.name, token.value);
  }

  const resolved: ResolvedTokens = { light: {}, dark: {} };
  for (const theme of THEMES) {
    const resolve = (name: string, chain: string[]): string => {
      if (chain.includes(name)) {
        throw new Error(`token ${chain[0]} aliases in a cycle: ${[...chain, name].join(' -> ')}`);
      }
      const value = raw.get(name)?.[theme];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(
          chain.length === 0
            ? `token ${name} has no ${theme} value`
            : `token ${chain[0]} aliases ${name}, which has no ${theme} value`
        );
      }
      const alias = ALIAS.exec(value.trim())?.[1];
      if (alias !== undefined) {
        if (!raw.has(alias)) {
          throw new Error(`token ${name} aliases {${alias}}, which is not a token`);
        }
        return resolve(alias, [...chain, name]);
      }
      const colour = normaliseColour(value.trim());
      if (!colour) throw new Error(`token ${name} has ${theme} value ${value}, not a colour`);
      return colour;
    };
    for (const name of raw.keys()) resolved[theme][name] = resolve(name, []);
  }
  return resolved;
}

/** The token names other tokens alias, in either theme. */
function aliasedNames(file: TokenFile): Set<string> {
  const names = new Set<string>();
  for (const token of file.color.tokens) {
    for (const value of Object.values(token.value)) {
      const alias = typeof value === 'string' ? ALIAS.exec(value.trim())?.[1] : undefined;
      if (alias !== undefined) names.add(alias);
    }
  }
  return names;
}

/** The palette key an interface role is read under: `text-on-fill` is `textOnFill`. */
export function roleKey(role: string): string {
  return role.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The keys of `colors` and `darkColors` that read a role, with the role's value. */
export function roleColours(resolved: ResolvedTokens, map: RoleMap): ResolvedTokens {
  const out: ResolvedTokens = { light: {}, dark: {} };
  for (const [key, entry] of Object.entries(map.keys)) {
    for (const theme of entry.from ?? []) {
      const value = entry.role ? resolved[theme][entry.role] : undefined;
      if (value === undefined) {
        throw new Error(`${key} reads role ${entry.role ?? '(none)'}, which is not a token`);
      }
      out[theme][key] = value;
    }
  }
  return out;
}

/**
 * Everything wrong between the token file, the role map and the palettes as
 * `colors.ts` builds them. `readers` are the tokens a generated output reads
 * outside the palette, the heatmap palettes and the native app colours.
 */
export function checkColourRoles(
  file: TokenFile,
  resolved: ResolvedTokens,
  map: RoleMap,
  palettes: Record<Theme, Record<string, string>>,
  readers: readonly string[]
): string[] {
  const problems: string[] = [];
  const tokens = new Set(Object.keys(resolved.light));
  const paletteKeys = new Set([...Object.keys(palettes.light), ...Object.keys(palettes.dark)]);

  for (const key of paletteKeys) {
    if (!(key in map.keys))
      problems.push(`colors key ${key} is neither mapped to a role nor dropped`);
  }
  for (const [key, entry] of Object.entries(map.keys)) {
    if (!paletteKeys.has(key)) {
      problems.push(`the role map lists ${key}, which neither colors nor darkColors has`);
      continue;
    }
    if (entry.role && entry.drop) {
      problems.push(`${key} both folds into ${entry.role} and is dropped`);
    }
    if (!entry.role && !entry.drop)
      problems.push(`${key} names neither a role nor a reason to drop`);
    for (const role of [entry.role, ...(entry.also ?? [])]) {
      if (role !== undefined && !tokens.has(role)) {
        problems.push(`${key} folds into ${role}, which is not a token`);
      }
    }
    for (const theme of entry.from ?? []) {
      if (!entry.role || !tokens.has(entry.role)) continue;
      const have = palettes[theme][key];
      const want = resolved[theme][entry.role];
      if (have === undefined) {
        problems.push(
          `${key} reads ${entry.role} in ${theme}, but the ${theme} palette has no ${key}`
        );
      } else if (normaliseColour(have) !== want) {
        problems.push(
          `${key} in ${theme} is ${have}, not ${entry.role} ${want}, so it was overridden`
        );
      }
    }
  }

  const interfaceRoles = new Set(map.interface ?? []);
  for (const role of interfaceRoles) {
    if (!tokens.has(role)) problems.push(`the interface role ${role} is not a token`);
  }
  for (const [key, entry] of Object.entries(map.keys)) {
    if (!entry.role || !interfaceRoles.has(entry.role)) continue;
    const name = roleKey(entry.role);
    const from = entry.from ?? [];
    if (key !== name && from.length > 0) {
      problems.push(
        `${key} reads the interface role ${entry.role}, which the palette names ${name}`
      );
    } else if (key === name && from.length < THEMES.length) {
      const read = from.length > 0 ? `in ${from.join(' and ')} only` : 'in neither theme';
      problems.push(
        `${key} is the interface role ${entry.role} and reads it ${read}, not in both themes`
      );
    }
  }

  const reservations = Object.keys(map.reserved);
  const reserved = (name: string) =>
    reservations.some((r) => (r.endsWith('*') ? name.startsWith(r.slice(0, -1)) : r === name));
  for (const r of reservations) {
    const matches = [...tokens].some((name) =>
      r.endsWith('*') ? name.startsWith(r.slice(0, -1)) : r === name
    );
    if (!matches) problems.push(`the reservation ${r} matches no token`);
  }
  const read = new Set<string>([...aliasedNames(file), ...readers]);
  for (const entry of Object.values(map.keys)) {
    if (entry.role) read.add(entry.role);
    for (const role of entry.also ?? []) read.add(role);
  }
  for (const name of tokens) {
    if (!read.has(name) && !reserved(name)) {
      problems.push(`role ${name} has no reader and is not reserved`);
    }
  }
  return problems;
}

const GEN = 'GENERATED by scripts/gen-colour-tokens.ts from src/theme/tokens.json. Do not edit.';
const RUN = 'Run: npm run gen:colour-tokens';

function rgb(colour: string): [number, number, number] {
  if (!colour.startsWith('#') || colour.length !== 7) {
    throw new Error(`the heatmap palette needs an opaque hex colour, not ${colour}`);
  }
  return [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16)) as [number, number, number];
}

/**
 * A heatmap palette as RGBA bytes by the class a tile pixel holds: 0 no heat,
 * 1 to 5 the steps, 6 the halo, transparent where the base paints none. A tile
 * is drawn once for both themes, so a token that differs between them is refused.
 */
export function heatPaletteBytes(
  resolved: ResolvedTokens,
  palette: HeatPalette
): [number, number, number, number][] {
  const opaque = (token: string): [number, number, number, number] => {
    const [light, dark] = [resolved.light[token], resolved.dark[token]];
    if (light === undefined) throw new Error(`heatmap token ${token} is not a token`);
    if (light !== dark) {
      throw new Error(`heatmap token ${token} is ${light} in light and ${dark} in dark`);
    }
    return [...rgb(light), 255];
  };
  if (palette.steps.length !== 5) {
    throw new Error(`the ${palette.base} heatmap has ${palette.steps.length} steps, not 5`);
  }
  const none: [number, number, number, number] = [0, 0, 0, 0];
  return [none, ...palette.steps.map(opaque), palette.halo ? opaque(palette.halo) : none];
}

const quoteKey = (key: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `'${key}'`);

function tsRecord(record: Record<string, string>, indent: string): string {
  return Object.entries(record)
    .map(([key, value]) => `${indent}${quoteKey(key)}: '${value}',`)
    .join('\n');
}

/** `src/theme/colourTokens.generated.ts`. */
export function renderTypeScript(resolved: ResolvedTokens, roles: ResolvedTokens): string {
  const themed = (record: ResolvedTokens) =>
    THEMES.map((theme) => `  ${theme}: {\n${tsRecord(record[theme], '    ')}\n  },`).join('\n');
  return `// ${GEN} ${RUN}

/** Every colour token in each theme, aliases resolved. */
export const colourTokens = {
${themed(resolved)}
} as const;

export type ColourToken = keyof typeof colourTokens.light;

/** The keys of \`colors\` and \`darkColors\` that read a role, per \`colourRoles.json\`. */
export const roleColours = {
${themed(roles)}
} as const;
`;
}

/** `modules/veloqrs/rust/veloqrs/src/heatmap_ramp.rs`. */
export function renderRustHeatPalettes(
  resolved: ResolvedTokens,
  palettes: readonly HeatPalette[]
): string {
  const tables = palettes.map((palette) => {
    const rows = heatPaletteBytes(resolved, palette).map((c) => `    [${c.join(', ')}],`);
    const name = `HEATMAP_${palette.base.toUpperCase()}`;
    return `pub(crate) const ${name}: [[u8; 4]; 7] = [\n${rows.join('\n')}\n];`;
  });
  return `// ${GEN} ${RUN}

// The heatmap tile palette of each base map as RGBA, indexed by the class a
// tile pixel holds: 0 no heat, 1 to 5 the heat steps from fewest passes to
// most, 6 the halo round the heat, transparent on a base that paints none.

${tables.join('\n\n')}
`;
}

/** `src/theme/appColours.json`, the colours native code draws before any JavaScript runs. */
export function renderAppColours(
  resolved: ResolvedTokens,
  sources: Record<string, string>
): string {
  const out: Record<string, string> = {};
  for (const [key, token] of Object.entries(sources)) {
    const value = resolved.light[token];
    if (value === undefined)
      throw new Error(`app colour ${key} reads ${token}, which is not a token`);
    out[key] = value;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The outputs whose committed text is not what the token file generates, in order. */
export function staleOutputs(
  expected: Record<string, string>,
  committed: (path: string) => string | null | undefined
): string[] {
  return Object.entries(expected)
    .filter(([path, text]) => committed(path) !== text)
    .map(([path]) => path);
}
