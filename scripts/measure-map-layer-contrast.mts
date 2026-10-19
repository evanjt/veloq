/**
 * The contrast the Map tab's section and route lines reach against what they
 * are drawn over: the base's own ground, and the heatmap composited over it.
 *
 * Run: npx tsx scripts/measure-map-layer-contrast.mts
 *
 * Each line colour is composited at the opacity the regional layer specs draw
 * it at, and measured as a WCAG relative-luminance ratio, the measure the 3:1
 * bar for a graphical object reads. Satellite has no ground of its own, so it
 * is read over the median colour of six aerial tiles at zoom 15 (town,
 * vineyard, forest, lake shore, bare rock and farmland), taken 2026-10-19.
 */
import { registerHooks } from 'node:module';
import { mapPalette, type MapBase } from '../src/theme/palette';
import { routePalette, sectionPalette } from '../src/theme/colors';

// The heatmap paint reads its tile stops through the theme's index, which also
// loads the React Native theme. Only the stops are needed, so the index is
// pointed at the generated token file they come from.
const TOKENS = new URL('../src/theme/colourTokens.generated.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    return resolved.url.endsWith('/src/theme/index.ts') ? { ...resolved, url: TOKENS } : resolved;
  },
});
const { heatmapKeyColours } = await import('../src/features/maps/lib/heatmapPaint');

const SATELLITE_GROUNDS: Record<string, string> = {
  town: '#747464',
  vineyard: '#617252',
  forest: '#485241',
  'lake shore': '#2B4247',
  rock: '#757B69',
  farmland: '#6B7B55',
};

/** The opacities `regionalMapLayerSpecs.ts` draws each line at with nothing selected. */
const SECTION_OPACITY = 0.95;
const ROUTE_OPACITY = 0.8;

type Rgb = [number, number, number];

const parse = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

const over = (top: Rgb, alpha: number, under: Rgb): Rgb =>
  top.map((c, i) => c * alpha + under[i] * (1 - alpha)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function grounds(base: MapBase): Record<string, string> {
  if (base === 'satellite') return SATELLITE_GROUNDS;
  const palette = mapPalette(base);
  return { land: palette.land };
}

const BASES = ['light', 'dark', 'satellite'] as const;

/** The smallest ratio over every pair, and how many pairs fall under 3:1. */
function tally(ratios: number[]): string {
  const under = ratios.filter((r) => r < 3).length;
  return `min ${Math.min(...ratios).toFixed(2)}:1, ${under}/${ratios.length} under 3:1`;
}

/** Each line colour against the ground, and against every heat stop over it. */
function measureBare(name: string, colours: readonly string[], opacity: number) {
  console.log(`\n${name}, as drawn today (no casing)`);
  for (const base of BASES) {
    const ground: number[] = [];
    const heat: number[] = [];
    for (const g of Object.values(grounds(base))) {
      const under = parse(g);
      for (const colour of colours) {
        ground.push(contrast(over(parse(colour), opacity, under), under));
        for (const h of heatmapKeyColours(base, g).map(parse)) {
          heat.push(contrast(over(parse(colour), opacity, h), h));
        }
      }
    }
    console.log(`  ${base.padEnd(9)} over ground: ${tally(ground)}; over heat: ${tally(heat)}`);
  }
}

/**
 * On a casing the line is read against the casing, whatever lies under both,
 * and the casing against the ground and the heat.
 */
function measureCased(
  name: string,
  colours: readonly string[],
  opacity: number,
  role: 'casing' | 'edge'
) {
  console.log(`\n${name}, on each base's own ${role}`);
  for (const base of BASES) {
    const casing = parse(mapPalette(base)[role]);
    const line = colours.map((c) => contrast(over(parse(c), opacity, casing), casing));
    const ground: number[] = [];
    const heat: number[] = [];
    for (const g of Object.values(grounds(base))) {
      ground.push(contrast(casing, parse(g)));
      for (const h of heatmapKeyColours(base, g).map(parse)) heat.push(contrast(casing, h));
    }
    console.log(
      `  ${base.padEnd(9)} ${role} ${mapPalette(base)[role]}; line on it: ${tally(line)};` +
        ` it on ground: ${tally(ground)}; it on heat: ${tally(heat)}`
    );
  }
}

measureBare('Section lines', sectionPalette, SECTION_OPACITY);
measureBare('Route lines', routePalette, ROUTE_OPACITY);
for (const role of ['casing', 'edge'] as const) {
  measureCased('Section lines', sectionPalette, SECTION_OPACITY, role);
  measureCased('Route lines', routePalette, ROUTE_OPACITY, role);
}
