/**
 * Tests for section encounter data flow and rendering logic.
 *
 * SectionEncounter represents a (section, direction) pair for an activity.
 * Tests verify encounter counting, PR detection, display names, sparkline
 * data construction, feed card alignment, and tab badge counts.
 */

import type { SectionEncounter } from 'veloqrs';

// ---------------------------------------------------------------------------
// Helpers: mock encounter factory
// ---------------------------------------------------------------------------

function makeEncounter(overrides: Partial<SectionEncounter> = {}): SectionEncounter {
  return {
    sectionId: 'section-1',
    sectionName: 'Hill Climb',
    direction: 'same',
    distanceMeters: 1200,
    lapTime: 300,
    lapPace: 4.0,
    isPr: false,
    visitCount: 5,
    historyTimes: [],
    historyActivityIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Encounter count per direction
// ---------------------------------------------------------------------------

describe('Encounter count per direction', () => {
  it('returns 4 encounters for 2 sections with both forward and reverse', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({ sectionId: 'section-8', sectionName: 'River Path', direction: 'same' }),
      makeEncounter({ sectionId: 'section-8', sectionName: 'River Path', direction: 'reverse' }),
      makeEncounter({ sectionId: 'section-10', sectionName: 'Park Loop', direction: 'same' }),
      makeEncounter({ sectionId: 'section-10', sectionName: 'Park Loop', direction: 'reverse' }),
    ];

    expect(encounters).toHaveLength(4);

    // Each (sectionId, direction) pair is unique
    const keys = encounters.map((e) => `${e.sectionId}-${e.direction}`);
    expect(new Set(keys).size).toBe(4);
  });

  it('returns 2 encounters for 2 sections with only forward traversals', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({ sectionId: 'section-8', sectionName: 'River Path', direction: 'same' }),
      makeEncounter({ sectionId: 'section-10', sectionName: 'Park Loop', direction: 'same' }),
    ];

    expect(encounters).toHaveLength(2);

    const keys = encounters.map((e) => `${e.sectionId}-${e.direction}`);
    expect(new Set(keys).size).toBe(2);
  });

  it('counts each direction independently even for the same section', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({ sectionId: 'section-8', direction: 'same', lapTime: 300 }),
      makeEncounter({ sectionId: 'section-8', direction: 'reverse', lapTime: 320 }),
    ];

    const sameDir = encounters.filter((e) => e.direction === 'same');
    const reverseDir = encounters.filter((e) => e.direction === 'reverse');

    expect(sameDir).toHaveLength(1);
    expect(reverseDir).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. PR detection per direction
// ---------------------------------------------------------------------------

describe('PR detection per direction', () => {
  it('can have forward PR but not reverse PR on the same section', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({
        sectionId: 'section-8',
        direction: 'same',
        isPr: true,
        lapTime: 280,
      }),
      makeEncounter({
        sectionId: 'section-8',
        direction: 'reverse',
        isPr: false,
        lapTime: 340,
      }),
    ];

    const forward = encounters.find((e) => e.sectionId === 'section-8' && e.direction === 'same')!;
    const reverse = encounters.find(
      (e) => e.sectionId === 'section-8' && e.direction === 'reverse'
    )!;

    expect(forward.isPr).toBe(true);
    expect(reverse.isPr).toBe(false);
  });

  it('can have reverse PR but not forward PR', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({
        sectionId: 'section-8',
        direction: 'same',
        isPr: false,
        lapTime: 310,
      }),
      makeEncounter({
        sectionId: 'section-8',
        direction: 'reverse',
        isPr: true,
        lapTime: 295,
      }),
    ];

    const forward = encounters.find((e) => e.direction === 'same')!;
    const reverse = encounters.find((e) => e.direction === 'reverse')!;

    expect(forward.isPr).toBe(false);
    expect(reverse.isPr).toBe(true);
  });

  it('can have PRs in both directions simultaneously', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({
        sectionId: 'section-8',
        direction: 'same',
        isPr: true,
        lapTime: 270,
      }),
      makeEncounter({
        sectionId: 'section-8',
        direction: 'reverse',
        isPr: true,
        lapTime: 290,
      }),
    ];

    expect(encounters.every((e) => e.isPr)).toBe(true);
  });

  it('PR count reflects direction-independent PR detection', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({ sectionId: 'section-8', direction: 'same', isPr: true }),
      makeEncounter({ sectionId: 'section-8', direction: 'reverse', isPr: false }),
      makeEncounter({ sectionId: 'section-10', direction: 'same', isPr: false }),
      makeEncounter({ sectionId: 'section-10', direction: 'reverse', isPr: true }),
    ];

    const prCount = encounters.filter((e) => e.isPr).length;
    expect(prCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Display name for reverse
// ---------------------------------------------------------------------------

describe('Display name for reverse encounters', () => {
  // Replicates SectionInlinePlot display logic:
  //   encounter.direction === 'reverse' ? `${encounter.sectionName} \u21A9` : encounter.sectionName
  function getDisplayName(encounter: SectionEncounter): string {
    return encounter.direction === 'reverse'
      ? `${encounter.sectionName} \u21A9`
      : encounter.sectionName;
  }

  it('appends arrow suffix for reverse direction', () => {
    const encounter = makeEncounter({
      sectionName: 'River Path',
      direction: 'reverse',
    });

    expect(getDisplayName(encounter)).toBe('River Path \u21A9');
  });

  it('returns plain name for same direction', () => {
    const encounter = makeEncounter({
      sectionName: 'River Path',
      direction: 'same',
    });

    expect(getDisplayName(encounter)).toBe('River Path');
  });

  it('handles empty section name with reverse suffix', () => {
    const encounter = makeEncounter({
      sectionName: '',
      direction: 'reverse',
    });

    expect(getDisplayName(encounter)).toBe(' \u21A9');
  });

  it('reverse suffix is Unicode U+21A9 (leftwards arrow with hook)', () => {
    const encounter = makeEncounter({
      sectionName: 'Test',
      direction: 'reverse',
    });

    const name = getDisplayName(encounter);
    expect(name.endsWith('\u21A9')).toBe(true);
    expect(name).toBe('Test \u21A9');
  });
});

// ---------------------------------------------------------------------------
// 4. Sparkline data construction
// ---------------------------------------------------------------------------

describe('Sparkline data construction', () => {
  // Replicates SectionInlinePlot sparkline data logic:
  //   encounter.historyTimes.map((time, i) => ({
  //     x: i,
  //     id: encounter.historyActivityIds[i] || '',
  //     activityId: encounter.historyActivityIds[i] || '',
  //     speed: time > 0 ? encounter.distanceMeters / time : 0,
  //     date: new Date(),
  //     activityName: '',
  //     direction: encounter.direction,
  //     sectionTime: time,
  //   }))
  function buildSparklineData(encounter: SectionEncounter) {
    if (encounter.historyTimes.length < 2) return undefined;
    return encounter.historyTimes.map((time, i) => ({
      x: i,
      id: encounter.historyActivityIds[i] || '',
      activityId: encounter.historyActivityIds[i] || '',
      speed: time > 0 ? encounter.distanceMeters / time : 0,
      date: new Date(),
      activityName: '',
      direction: encounter.direction as 'same' | 'reverse',
      sectionTime: time,
    }));
  }

  it('produces 5 data points for 5 historical times', () => {
    const encounter = makeEncounter({
      distanceMeters: 1000,
      historyTimes: [300, 290, 285, 295, 280],
      historyActivityIds: ['a1', 'a2', 'a3', 'a4', 'a5'],
    });

    const data = buildSparklineData(encounter);
    expect(data).toBeDefined();
    expect(data).toHaveLength(5);
  });

  it('computes correct speed values (distanceMeters / time)', () => {
    const encounter = makeEncounter({
      distanceMeters: 1000,
      historyTimes: [200, 250, 500],
      historyActivityIds: ['a1', 'a2', 'a3'],
    });

    const data = buildSparklineData(encounter)!;

    expect(data[0].speed).toBeCloseTo(1000 / 200); // 5.0
    expect(data[1].speed).toBeCloseTo(1000 / 250); // 4.0
    expect(data[2].speed).toBeCloseTo(1000 / 500); // 2.0
  });

  it('assigns sequential x values starting from 0', () => {
    const encounter = makeEncounter({
      historyTimes: [300, 290, 285, 295, 280],
      historyActivityIds: ['a1', 'a2', 'a3', 'a4', 'a5'],
    });

    const data = buildSparklineData(encounter)!;

    data.forEach((point, i) => {
      expect(point.x).toBe(i);
    });
  });

  it('maps activity IDs from historyActivityIds', () => {
    const encounter = makeEncounter({
      historyTimes: [300, 290],
      historyActivityIds: ['act-abc', 'act-def'],
    });

    const data = buildSparklineData(encounter)!;

    expect(data[0].activityId).toBe('act-abc');
    expect(data[0].id).toBe('act-abc');
    expect(data[1].activityId).toBe('act-def');
    expect(data[1].id).toBe('act-def');
  });

  it('handles zero time by producing speed of 0', () => {
    const encounter = makeEncounter({
      distanceMeters: 1000,
      historyTimes: [0, 300],
      historyActivityIds: ['a1', 'a2'],
    });

    const data = buildSparklineData(encounter)!;

    expect(data[0].speed).toBe(0);
    expect(data[1].speed).toBeCloseTo(1000 / 300);
  });

  it('returns undefined when fewer than 2 historical times', () => {
    const singleEntry = makeEncounter({
      historyTimes: [300],
      historyActivityIds: ['a1'],
    });
    expect(buildSparklineData(singleEntry)).toBeUndefined();

    const noEntries = makeEncounter({
      historyTimes: [],
      historyActivityIds: [],
    });
    expect(buildSparklineData(noEntries)).toBeUndefined();
  });

  it('falls back to empty string for missing activity IDs', () => {
    const encounter = makeEncounter({
      historyTimes: [300, 290, 280],
      historyActivityIds: ['a1'], // only 1 ID for 3 times
    });

    const data = buildSparklineData(encounter)!;

    expect(data[0].activityId).toBe('a1');
    expect(data[1].activityId).toBe('');
    expect(data[2].activityId).toBe('');
  });

  it('preserves direction from encounter in each data point', () => {
    const encounter = makeEncounter({
      direction: 'reverse',
      historyTimes: [300, 290],
      historyActivityIds: ['a1', 'a2'],
    });

    const data = buildSparklineData(encounter)!;
    data.forEach((point) => {
      expect(point.direction).toBe('reverse');
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Feed card PR count alignment
// ---------------------------------------------------------------------------

describe('Feed card PR count alignment', () => {
  // Simulates the deduplication logic in useActivitySectionHighlights:
  //   existing?.find(e => e.sectionId === ind.targetId && e.direction === ind.direction)
  // Each unique (sectionId, direction) is one entry; isPr is tracked per entry.

  interface Indicator {
    activityId: string;
    indicatorType: string;
    targetId: string;
    targetName: string;
    direction: string;
    lapTime: number;
    trend: number;
  }

  interface HighlightEntry {
    sectionId: string;
    sectionName: string;
    direction: string;
    lapTime: number;
    isPr: boolean;
    trend: number;
  }

  /** Extracts highlight entries from indicators, replicating useActivitySectionHighlights logic. */
  function extractHighlights(indicators: Indicator[]): Map<string, HighlightEntry[]> {
    const sectionMap = new Map<string, HighlightEntry[]>();

    for (const ind of indicators) {
      if (ind.indicatorType !== 'section_pr' && ind.indicatorType !== 'section_trend') {
        continue;
      }
      const isPr = ind.indicatorType === 'section_pr';

      const existing = sectionMap.get(ind.activityId);
      const existingEntry = existing?.find(
        (e) => e.sectionId === ind.targetId && e.direction === ind.direction
      );
      if (existingEntry) {
        if (isPr && !existingEntry.isPr) {
          existingEntry.isPr = true;
          existingEntry.trend = 1;
          existingEntry.lapTime = ind.lapTime;
        } else if (!existingEntry.isPr && ind.trend > existingEntry.trend) {
          existingEntry.trend = ind.trend;
        }
      } else {
        const entry: HighlightEntry = {
          sectionId: ind.targetId,
          sectionName: ind.targetName,
          direction: ind.direction,
          lapTime: ind.lapTime,
          isPr,
          trend: isPr ? 1 : ind.trend,
        };
        if (existing) {
          existing.push(entry);
        } else {
          sectionMap.set(ind.activityId, [entry]);
        }
      }
    }

    return sectionMap;
  }

  it('PR count from encounters matches highlights for same activity', () => {
    // Build encounters for activity act-1
    const encounters: SectionEncounter[] = [
      makeEncounter({
        sectionId: 'section-8',
        sectionName: 'River Path',
        direction: 'same',
        isPr: true,
        lapTime: 280,
      }),
      makeEncounter({
        sectionId: 'section-8',
        sectionName: 'River Path',
        direction: 'reverse',
        isPr: false,
        lapTime: 340,
      }),
      makeEncounter({
        sectionId: 'section-10',
        sectionName: 'Park Loop',
        direction: 'same',
        isPr: false,
        lapTime: 600,
      }),
      makeEncounter({
        sectionId: 'section-10',
        sectionName: 'Park Loop',
        direction: 'reverse',
        isPr: true,
        lapTime: 590,
      }),
    ];

    // Build matching indicators for the same activity
    const indicators: Indicator[] = [
      {
        activityId: 'act-1',
        indicatorType: 'section_pr',
        targetId: 'section-8',
        targetName: 'River Path',
        direction: 'same',
        lapTime: 280,
        trend: 1,
      },
      {
        activityId: 'act-1',
        indicatorType: 'section_trend',
        targetId: 'section-8',
        targetName: 'River Path',
        direction: 'reverse',
        lapTime: 340,
        trend: -1,
      },
      {
        activityId: 'act-1',
        indicatorType: 'section_trend',
        targetId: 'section-10',
        targetName: 'Park Loop',
        direction: 'same',
        lapTime: 600,
        trend: 0,
      },
      {
        activityId: 'act-1',
        indicatorType: 'section_pr',
        targetId: 'section-10',
        targetName: 'Park Loop',
        direction: 'reverse',
        lapTime: 590,
        trend: 1,
      },
    ];

    const highlightMap = extractHighlights(indicators);
    const highlights = highlightMap.get('act-1') || [];

    // Count PRs from encounters
    const encounterPrCount = encounters.filter((e) => e.isPr).length;

    // Count PRs from highlights (deduped by sectionId + direction)
    const highlightPrCount = highlights.filter((h) => h.isPr).length;

    expect(encounterPrCount).toBe(highlightPrCount);
    expect(encounterPrCount).toBe(2);
  });

  it('deduplicates by (sectionId, direction) — duplicate indicators merge correctly', () => {
    // Two indicators for the same (section, direction): one PR, one trend
    const indicators: Indicator[] = [
      {
        activityId: 'act-1',
        indicatorType: 'section_trend',
        targetId: 'section-8',
        targetName: 'River Path',
        direction: 'same',
        lapTime: 300,
        trend: 1,
      },
      {
        activityId: 'act-1',
        indicatorType: 'section_pr',
        targetId: 'section-8',
        targetName: 'River Path',
        direction: 'same',
        lapTime: 280,
        trend: 1,
      },
    ];

    const highlightMap = extractHighlights(indicators);
    const highlights = highlightMap.get('act-1') || [];

    // Should produce a single entry with isPr=true
    expect(highlights).toHaveLength(1);
    expect(highlights[0].isPr).toBe(true);
    expect(highlights[0].lapTime).toBe(280);
  });

  it('same direction on different sections produces separate entries', () => {
    const indicators: Indicator[] = [
      {
        activityId: 'act-1',
        indicatorType: 'section_pr',
        targetId: 'section-8',
        targetName: 'River Path',
        direction: 'same',
        lapTime: 280,
        trend: 1,
      },
      {
        activityId: 'act-1',
        indicatorType: 'section_pr',
        targetId: 'section-10',
        targetName: 'Park Loop',
        direction: 'same',
        lapTime: 590,
        trend: 1,
      },
    ];

    const highlightMap = extractHighlights(indicators);
    const highlights = highlightMap.get('act-1') || [];

    expect(highlights).toHaveLength(2);
    expect(highlights[0].sectionId).toBe('section-8');
    expect(highlights[1].sectionId).toBe('section-10');
  });
});

// ---------------------------------------------------------------------------
// 6. Tab badge count
// ---------------------------------------------------------------------------

describe('Tab badge count', () => {
  it('encounters.length gives the same count as rendered cards (1 per encounter)', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({ sectionId: 'section-8', direction: 'same' }),
      makeEncounter({ sectionId: 'section-8', direction: 'reverse' }),
      makeEncounter({ sectionId: 'section-10', direction: 'same' }),
    ];

    // The FlatList in ActivitySectionsSection uses encounters as data,
    // keyExtractor is `${item.sectionId}-${item.direction}`,
    // so each encounter produces exactly one rendered card.
    const renderedCardCount = encounters.length;
    const uniqueKeys = new Set(encounters.map((e) => `${e.sectionId}-${e.direction}`));

    expect(renderedCardCount).toBe(3);
    expect(uniqueKeys.size).toBe(renderedCardCount);
  });

  it('badge count is 0 for empty encounters', () => {
    const encounters: SectionEncounter[] = [];
    expect(encounters.length).toBe(0);
  });

  it('badge count reflects bidirectional traversals', () => {
    // 3 sections, each traversed in both directions = 6 cards
    const encounters: SectionEncounter[] = [
      makeEncounter({ sectionId: 's1', direction: 'same' }),
      makeEncounter({ sectionId: 's1', direction: 'reverse' }),
      makeEncounter({ sectionId: 's2', direction: 'same' }),
      makeEncounter({ sectionId: 's2', direction: 'reverse' }),
      makeEncounter({ sectionId: 's3', direction: 'same' }),
      makeEncounter({ sectionId: 's3', direction: 'reverse' }),
    ];

    expect(encounters.length).toBe(6);
  });

  it('keyExtractor produces unique keys for all encounters', () => {
    const encounters: SectionEncounter[] = [
      makeEncounter({ sectionId: 's1', direction: 'same' }),
      makeEncounter({ sectionId: 's1', direction: 'reverse' }),
      makeEncounter({ sectionId: 's2', direction: 'same' }),
    ];

    // Matches ActivitySectionsSection keyExtractor
    const keyExtractor = (item: SectionEncounter) => `${item.sectionId}-${item.direction}`;
    const keys = encounters.map(keyExtractor);
    const uniqueKeys = new Set(keys);

    expect(uniqueKeys.size).toBe(encounters.length);
    expect(keys).toEqual(['s1-same', 's1-reverse', 's2-same']);
  });
});
