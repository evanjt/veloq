/**
 * Expected behaviour: the ladder is symmetric about the track and its
 * boundaries belong to the coarser level. A finger resting on a threshold
 * changes level once and leaves it only after coming back by a margin, and the
 * crossing haptic is held to a floor between fires.
 */
import {
  levelRatio,
  precisionLevel,
  shouldMarkCrossing,
  type PrecisionLevel,
} from '@/features/routes/lib/trimPrecision';

function fold(dys: number[], start: PrecisionLevel = 'normal') {
  const levels: PrecisionLevel[] = [];
  let level = start;
  let changes = 0;
  for (const dy of dys) {
    const next = precisionLevel(dy, level);
    if (next !== level) changes += 1;
    level = next;
    levels.push(level);
  }
  return { levels, changes };
}

describe('the trim precision ladder', () => {
  it.each([
    [0, 'normal'],
    [19, 'normal'],
    [20, 'precision'],
    [59, 'precision'],
    [60, 'fine'],
    [400, 'fine'],
  ])('reads %p as %p', (dy, level) => {
    expect(precisionLevel(dy)).toBe(level);
  });

  it('is symmetric about the track', () => {
    for (const dy of [0, 19, 20, 59, 60, 400]) {
      expect(precisionLevel(-dy)).toBe(precisionLevel(dy));
    }
    expect(precisionLevel(-15, 'precision')).toBe('precision');
  });

  it('slows the handle as the level deepens', () => {
    expect(levelRatio('normal')).toBe(1);
    expect(levelRatio('precision')).toBe(0.25);
    expect(levelRatio('fine')).toBe(0.125);
  });
});

describe('hysteresis', () => {
  it('changes level once for a finger wobbling on the first threshold', () => {
    const { levels, changes } = fold([19, 21, 19, 21, 19]);
    expect(changes).toBe(1);
    expect(levels).toEqual(['normal', 'precision', 'precision', 'precision', 'precision']);
  });

  it('changes level once for a finger wobbling on the second threshold', () => {
    const { changes } = fold([59, 61, 59, 61, 59], 'precision');
    expect(changes).toBe(1);
  });

  it('changes level four times across a full out and back', () => {
    const out = Array.from({ length: 81 }, (_, i) => i);
    const { levels, changes } = fold([...out, ...out.slice().reverse()]);
    expect(changes).toBe(4);
    expect(levels[20]).toBe('precision');
    expect(levels[60]).toBe('fine');
    expect(levels[81 + 27]).toBe('precision');
    expect(levels[81 + 67]).toBe('normal');
  });

  it('treats a negative offset as its magnitude', () => {
    expect(fold([-19, -21, -19, -21, -19]).changes).toBe(1);
  });

  it('leaves precision just below the margin and not at it', () => {
    expect(precisionLevel(13.9, 'precision')).toBe('normal');
    expect(precisionLevel(14.1, 'precision')).toBe('precision');
    expect(precisionLevel(14, 'precision')).toBe('precision');
  });

  it('leaves fine just below the margin and not at it', () => {
    expect(precisionLevel(53.9, 'fine')).toBe('precision');
    expect(precisionLevel(54, 'fine')).toBe('fine');
  });

  it('drops from fine to normal in one step when the finger jumps back', () => {
    expect(precisionLevel(0, 'fine')).toBe('normal');
  });

  it('does not enter a level early because of the margin', () => {
    expect(precisionLevel(19.9, 'normal')).toBe('normal');
    expect(precisionLevel(59.9, 'precision')).toBe('precision');
  });
});

describe('the haptic floor', () => {
  it('marks the first crossing of a drag', () => {
    expect(shouldMarkCrossing(5, 0)).toBe(true);
  });

  it('holds a crossing 79 ms after the last fire and allows it at 80 ms', () => {
    expect(shouldMarkCrossing(1079, 1000)).toBe(false);
    expect(shouldMarkCrossing(1080, 1000)).toBe(true);
  });
});
