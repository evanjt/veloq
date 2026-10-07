import {
  feedRangeForPreset,
  firstRangePage,
  olderRangePage,
  type FeedRange,
} from '@/features/activity/lib/feedRange';

function pagesOf(range: FeedRange): FeedRange[] {
  const pages = [firstRangePage(range)];
  for (;;) {
    const next = olderRangePage(range, pages[pages.length - 1]);
    if (!next) return pages;
    pages.push(next);
  }
}

describe('feed range paging', () => {
  it('covers March 2024 exactly, from the newest day back, and never leaves it', () => {
    const range = { oldest: '2024-03-01', newest: '2024-03-31' };
    const pages = pagesOf(range);
    expect(pages).toEqual([
      { oldest: '2024-03-02', newest: '2024-03-31' },
      { oldest: '2024-03-01', newest: '2024-03-01' },
    ]);
  });

  it('reads a range shorter than a page in one page', () => {
    const range = { oldest: '2024-03-10', newest: '2024-03-12' };
    expect(pagesOf(range)).toEqual([range]);
  });

  it('leaves no gap and no overlap across a long range', () => {
    const range = { oldest: '2023-01-01', newest: '2023-12-31' };
    const pages = pagesOf(range);
    expect(pages[0].newest).toBe(range.newest);
    expect(pages[pages.length - 1].oldest).toBe(range.oldest);
    for (let i = 1; i < pages.length; i++) {
      const day = new Date(`${pages[i].newest}T00:00:00Z`).getTime() + 86400000;
      expect(new Date(day).toISOString().slice(0, 10)).toBe(pages[i - 1].oldest);
    }
  });

  it('reads a single day as one page', () => {
    const range = { oldest: '2024-02-29', newest: '2024-02-29' };
    expect(pagesOf(range)).toEqual([range]);
  });
});

describe('feed range presets', () => {
  it('names the last 90 days including today', () => {
    expect(feedRangeForPreset('last90Days', '2026-10-06')).toEqual({
      oldest: '2026-07-09',
      newest: '2026-10-06',
    });
  });

  it('names this year up to today and last year whole', () => {
    expect(feedRangeForPreset('thisYear', '2026-10-06')).toEqual({
      oldest: '2026-01-01',
      newest: '2026-10-06',
    });
    expect(feedRangeForPreset('lastYear', '2026-10-06')).toEqual({
      oldest: '2025-01-01',
      newest: '2025-12-31',
    });
  });
});
