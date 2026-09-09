/**
 * Scenario: the section screen's GPX export was one of three hand-rolled
 * copies of the same button, each with its own ground, radius, padding and
 * text style, and it is the proof conversion for the shared component.
 *
 * Expected behaviour: the screen renders `Button` from `@/shared/ui`, and the
 * style block that used to draw the button holds only where it sits. Read from
 * the source, because importing the style module pulls the whole `shared/ui`
 * barrel and with it the native engine, which is a mock tower for one
 * assertion.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const SCREEN = readFileSync(join(ROOT, 'src/app/section/[id].tsx'), 'utf8');
const STYLES = readFileSync(
  join(ROOT, 'src/features/routes/components/section/SectionDetail.styles.ts'),
  'utf8'
);

describe('the section export button, converted', () => {
  it('renders the shared Button rather than its own TouchableOpacity', () => {
    expect(SCREEN).toMatch(/import \{[^}]*\bButton\b[^}]*\} from '@\/shared\/ui'/);
    expect(SCREEN).toContain('<Button');
    expect(SCREEN).toContain('testID="section-export-gpx"');
  });

  it('stops drawing a button of its own on that screen', () => {
    expect(SCREEN).not.toContain('TouchableOpacity');
  });

  it('keeps only where the button sits, and no ground, radius or padding', () => {
    const block = STYLES.slice(
      STYLES.indexOf('exportGpxButton: {'),
      STYLES.indexOf('}', STYLES.indexOf('exportGpxButton: {'))
    );

    expect(block).toContain('marginHorizontal');
    expect(block).toContain('marginBottom');
    for (const owned of ['backgroundColor', 'borderRadius', 'paddingVertical', 'shadowColor']) {
      expect(block).not.toContain(owned);
    }
  });

  it('leaves no orphaned text or dark-mode style behind it', () => {
    expect(STYLES).not.toContain('exportGpxButtonText');
    expect(STYLES).not.toContain('exportGpxButtonDark');
  });
});
