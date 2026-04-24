import { findRowIndexAtPageY } from '@/components/activity/scrubHitTest';

// Realistic numbers pulled from actual device layout: row 0 at window-Y 261
// (= 245 list container + 16 padding), 62px tall (54 card + 4 marginBottom +
// 2*2 border), four section rows in a typical activity.
const DEFAULT = {
  firstRowTopY: 261,
  rowHeight: 62,
  scrollOffset: 0,
  rowCount: 4,
} as const;

describe('findRowIndexAtPageY', () => {
  describe('guards', () => {
    it('returns null when no rows have been rendered yet', () => {
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 300, rowCount: 0 })).toBeNull();
    });

    it('returns null before the first row has been measured', () => {
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 300, rowHeight: 0 })).toBeNull();
    });

    it('returns null above row 0', () => {
      // Row 0 starts at 261; anything above must miss.
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 260 })).toBeNull();
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 100 })).toBeNull();
    });

    it('returns null below the last row', () => {
      // 4 rows × 62 = 248, ending at 509. 510+ is past the list.
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 510 })).toBeNull();
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 800 })).toBeNull();
    });

    it('rejects negative row height defensively', () => {
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 300, rowHeight: -10 })).toBeNull();
    });
  });

  describe('tap anywhere inside a row resolves to that row', () => {
    // Each row N spans [261 + 62N, 261 + 62(N+1)):
    //   row 0: [261, 323)  row 1: [323, 385)  row 2: [385, 447)  row 3: [447, 509)
    it.each<[number, number, string]>([
      [0, 261, 'row 0 top edge'],
      [0, 292, 'row 0 middle (the "natural" tap point)'],
      [0, 322, 'row 0 bottom'],
      [1, 323, 'row 1 top'],
      [1, 354, 'row 1 middle'],
      [1, 384, 'row 1 bottom'],
      [2, 385, 'row 2 top'],
      [2, 416, 'row 2 middle'],
      [2, 446, 'row 2 bottom'],
      [3, 447, 'row 3 top'],
      [3, 478, 'row 3 middle'],
      [3, 508, 'row 3 bottom'],
    ])('resolves to row %i for pageY=%i (%s)', (expected, pageY) => {
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY })).toBe(expected);
    });
  });

  describe('monotonic scan — no row is ever silently skipped', () => {
    it('a top-to-bottom sweep visits every row in order', () => {
      const visited = new Set<number>();
      let prev = -1;
      for (let y = 261; y < 509; y += 2) {
        const idx = findRowIndexAtPageY({ ...DEFAULT, pageY: y });
        if (idx === null) continue;
        // Row index never decreases during a downward sweep.
        expect(idx).toBeGreaterThanOrEqual(prev);
        // Row index never jumps by more than 1.
        if (prev >= 0) expect(idx - prev).toBeLessThanOrEqual(1);
        prev = idx;
        visited.add(idx);
      }
      expect(visited).toEqual(new Set([0, 1, 2, 3]));
    });
  });

  describe('duplicate sectionId safety — row 0 vs row 1 are independently reachable', () => {
    // The hit-test returns a bare index; the component keys highlights by
    // `${sectionId}-${direction}` so two rows sharing a sectionId don't
    // both light up. This regression case verifies the two indexes remain
    // distinct across a small sweep (the previous Map-keyed implementation
    // overwrote the first with the second when sectionIds collided).
    it('row 0 and row 1 map to distinct indexes', () => {
      const row0 = findRowIndexAtPageY({ ...DEFAULT, pageY: 292 });
      const row1 = findRowIndexAtPageY({ ...DEFAULT, pageY: 354 });
      expect(row0).toBe(0);
      expect(row1).toBe(1);
    });
  });

  describe('scroll offset', () => {
    it('shifts the resolved row as the list scrolls', () => {
      // Without scroll, middle of row 0.
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 292 })).toBe(0);
      // List scrolled up by one row — same finger pageY now lands on row 1.
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 292, scrollOffset: 62 })).toBe(1);
      // Scrolled up by two rows — row 2.
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 292, scrollOffset: 124 })).toBe(2);
    });
  });

  describe('row boundary determinism', () => {
    it('the boundary between two rows snaps down (floor semantics)', () => {
      // pageY=322 is the last pixel of row 0; 323 is the first of row 1.
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 322 })).toBe(0);
      expect(findRowIndexAtPageY({ ...DEFAULT, pageY: 323 })).toBe(1);
    });
  });
});
