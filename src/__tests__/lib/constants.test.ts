import { SECTION_PATTERNS, SECTION_COLORS, getSectionStyle } from '@/lib/utils/constants';

describe('getSectionStyle', () => {
  it('returns pattern and color for index 0', () => {
    const style = getSectionStyle(0);
    expect(style.pattern).toBeUndefined(); // solid
    expect(style.color).toBe(SECTION_COLORS[0]);
    expect(style.patternIndex).toBe(0);
    expect(style.colorIndex).toBe(0);
  });

  it('cycles patterns before colors', () => {
    const numPatterns = SECTION_PATTERNS.length;
    // Index 1 should use pattern 1, color 0
    const style1 = getSectionStyle(1);
    expect(style1.patternIndex).toBe(1);
    expect(style1.colorIndex).toBe(0);

    // Index numPatterns should cycle to pattern 0, color 1
    const styleWrap = getSectionStyle(numPatterns);
    expect(styleWrap.patternIndex).toBe(0);
    expect(styleWrap.colorIndex).toBe(1);
  });

  it('produces unique styles up to patterns * colors', () => {
    const total = SECTION_PATTERNS.length * SECTION_COLORS.length;
    const seen = new Set<string>();
    for (let i = 0; i < total; i++) {
      const s = getSectionStyle(i);
      seen.add(`${s.patternIndex}-${s.colorIndex}`);
    }
    expect(seen.size).toBe(total);
  });
});
