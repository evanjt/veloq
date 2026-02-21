import {
  TIME,
  CACHE,
  RATE_LIMIT,
  CHART,
  SYNC,
  UI,
  API_DEFAULTS,
  OAUTH,
  SECTION_PATTERNS,
  SECTION_COLORS,
  getSectionStyle,
  TIME_RANGES,
} from '@/lib/utils/constants';

describe('TIME constants', () => {
  it('has correct millisecond values', () => {
    expect(TIME.SECOND).toBe(1000);
    expect(TIME.MINUTE).toBe(60_000);
    expect(TIME.HOUR).toBe(3_600_000);
    expect(TIME.DAY).toBe(86_400_000);
  });

  it('maintains expected relationships', () => {
    expect(TIME.MINUTE).toBe(TIME.SECOND * 60);
    expect(TIME.HOUR).toBe(TIME.MINUTE * 60);
    expect(TIME.DAY).toBe(TIME.HOUR * 24);
  });
});

describe('CACHE constants', () => {
  it('has increasing durations', () => {
    expect(CACHE.SHORT).toBeLessThan(CACHE.MEDIUM);
    expect(CACHE.MEDIUM).toBeLessThan(CACHE.LONG);
    expect(CACHE.LONG).toBeLessThan(CACHE.HOUR);
    expect(CACHE.HOUR).toBeLessThan(CACHE.DAY);
    expect(CACHE.DAY).toBeLessThan(CACHE.MONTH);
  });

  it('derived from TIME constants', () => {
    expect(CACHE.SHORT).toBe(TIME.MINUTE * 5);
    expect(CACHE.HOUR).toBe(TIME.HOUR);
    expect(CACHE.DAY).toBe(TIME.DAY);
  });
});

describe('RATE_LIMIT constants', () => {
  it('has safe API limits', () => {
    expect(RATE_LIMIT.MAX_PER_WINDOW).toBeLessThanOrEqual(132);
    expect(RATE_LIMIT.WINDOW_SIZE).toBe(10_000);
    expect(RATE_LIMIT.MIN_INTERVAL).toBeGreaterThan(0);
  });
});

describe('CHART constants', () => {
  it('has positive height values', () => {
    expect(CHART.DEFAULT_HEIGHT).toBeGreaterThan(0);
    expect(CHART.SMALL_HEIGHT).toBeGreaterThan(0);
    expect(CHART.SMALL_HEIGHT).toBeLessThan(CHART.DEFAULT_HEIGHT);
  });
});

describe('SYNC constants', () => {
  it('has valid sync periods', () => {
    expect(SYNC.INITIAL_DAYS).toBe(90);
    expect(SYNC.MAX_HISTORY_YEARS).toBe(10);
    expect(SYNC.BACKGROUND_DAYS).toBeGreaterThan(SYNC.INITIAL_DAYS);
  });
});

describe('OAUTH constants', () => {
  it('has required OAuth fields', () => {
    expect(OAUTH.CLIENT_ID).toBeTruthy();
    expect(OAUTH.AUTH_ENDPOINT).toContain('intervals.icu');
    expect(OAUTH.APP_SCHEME).toBe('veloq');
    expect(OAUTH.SCOPES.length).toBeGreaterThan(0);
  });
});

describe('SECTION_PATTERNS', () => {
  it('has at least 2 patterns', () => {
    expect(SECTION_PATTERNS.length).toBeGreaterThanOrEqual(2);
  });

  it('first pattern is solid (undefined)', () => {
    expect(SECTION_PATTERNS[0]).toBeUndefined();
  });

  it('non-solid patterns are number arrays', () => {
    for (let i = 1; i < SECTION_PATTERNS.length; i++) {
      expect(Array.isArray(SECTION_PATTERNS[i])).toBe(true);
      for (const val of SECTION_PATTERNS[i]!) {
        expect(typeof val).toBe('number');
        expect(val).toBeGreaterThan(0);
      }
    }
  });
});

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

describe('TIME_RANGES', () => {
  it('has expected time range options', () => {
    const ids = TIME_RANGES.map((r) => r.id);
    expect(ids).toContain('7d');
    expect(ids).toContain('1m');
    expect(ids).toContain('1y');
  });

  it('all entries have id and label', () => {
    for (const range of TIME_RANGES) {
      expect(range.id).toBeTruthy();
      expect(range.label).toBeTruthy();
    }
  });
});
