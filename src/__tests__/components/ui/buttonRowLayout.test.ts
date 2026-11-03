/**
 * Scenario: a row of equal buttons divides its width without asking whether each share holds the
 * longest word of its label, and the label then breaks inside the word.
 *
 * Expected behaviour: the row sits side by side only when every button's share holds its longest
 * word plus its own padding and glyph; otherwise the buttons stack.
 */

import { buttonRowLayout, labelWords } from '@/shared/ui/buttonRowLayout';

const GAP = 8;
// Padding both sides plus a glyph and its gap, for a medium button with an icon.
const CHROME = 16 * 2 + 20 + 4;
// "Review", "Idea", "Forum" at the default font scale, in dp.
const WORDS = [52, 34, 46];
const scaled = (factor: number) => WORDS.map((w) => w * factor);
const chrome = WORDS.map(() => CHROME);

describe('labelWords', () => {
  it('splits a label at its spaces', () => {
    expect(labelWords('Remind me later')).toEqual(['Remind', 'me', 'later']);
    expect(labelWords('Forum')).toEqual(['Forum']);
  });

  it('copes with an empty label and runs of spaces', () => {
    expect(labelWords('')).toEqual([]);
    expect(labelWords('  a   bc ')).toEqual(['a', 'bc']);
  });
});

describe('buttonRowLayout', () => {
  it('stacks three labels whose longest word is wider than a third of 360 dp', () => {
    expect(buttonRowLayout({ width: 304, gap: GAP, wordWidths: WORDS, chromeWidths: chrome })).toBe(
      'stack'
    );
  });

  it('sits the same labels side by side at 600 dp', () => {
    expect(buttonRowLayout({ width: 552, gap: GAP, wordWidths: WORDS, chromeWidths: chrome })).toBe(
      'row'
    );
  });

  it('stacks the same labels at font scale 2.0 on 412 dp', () => {
    expect(
      buttonRowLayout({ width: 356, gap: GAP, wordWidths: scaled(2), chromeWidths: chrome })
    ).toBe('stack');
  });

  it('holds a row exactly at the width where every share fits, and stacks one dp under', () => {
    const need = Math.max(...WORDS) + CHROME;
    const width = need * 3 + GAP * 2;
    expect(buttonRowLayout({ width, gap: GAP, wordWidths: WORDS, chromeWidths: chrome })).toBe(
      'row'
    );
    expect(
      buttonRowLayout({ width: width - 1, gap: GAP, wordWidths: WORDS, chromeWidths: chrome })
    ).toBe('stack');
  });

  it('keeps a row before anything is measured', () => {
    expect(buttonRowLayout({ width: 0, gap: GAP, wordWidths: [], chromeWidths: [] })).toBe('row');
    expect(
      buttonRowLayout({ width: 300, gap: GAP, wordWidths: [0, 0, 0], chromeWidths: chrome })
    ).toBe('row');
  });

  it('always keeps a single button in a row', () => {
    expect(buttonRowLayout({ width: 40, gap: GAP, wordWidths: [200], chromeWidths: [32] })).toBe(
      'row'
    );
  });
});
