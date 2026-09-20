/**
 * Scenario: the widget codegen builds its palette from the colour and spacing
 * modules and runs outside the React Native runtime. A `react-native` import
 * anywhere in that graph is handed to esbuild, which cannot transform it, and
 * the generator stops running at all. It did, and the committed widget
 * constants drifted for as long as nobody ran it.
 *
 * Expected behaviour: the modules the codegen reads import no react-native.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

/** What `widgetTheme.ts` reads, and what those read in turn. */
const CODEGEN_GRAPH = [
  'src/shared/theme/widgetTheme.ts',
  'src/theme/colors.ts',
  'src/theme/spacing.ts',
];

describe('the widget codegen import graph', () => {
  it.each(CODEGEN_GRAPH)('%s imports no react-native', (rel) => {
    const source = readFileSync(join(ROOT, rel), 'utf8');

    expect(source).not.toMatch(/from\s+'react-native'/);
  });

  it('reads the theme modules directly rather than through the barrel', () => {
    const source = readFileSync(join(ROOT, 'src/shared/theme/widgetTheme.ts'), 'utf8');

    expect(source).not.toMatch(/from\s+'@\/theme'/);
  });
});
