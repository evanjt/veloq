import { mergeHasMore, routesPageQuery } from '../routesPageQuery';

const PAGING = { groupOffset: 100, sectionOffset: 50, groupLimit: 50, sectionLimit: 50 };

describe('routesPageQuery', () => {
  it('reads both lists at their offsets when both are paged', () => {
    expect(routesPageQuery('both', PAGING)).toEqual(PAGING);
  });

  it('reads no sections when paging groups', () => {
    expect(routesPageQuery('groups', PAGING)).toEqual({
      groupOffset: 100,
      groupLimit: 50,
      sectionOffset: 0,
      sectionLimit: 0,
    });
  });

  it('reads no groups when paging sections', () => {
    expect(routesPageQuery('sections', PAGING)).toEqual({
      groupOffset: 0,
      groupLimit: 0,
      sectionOffset: 50,
      sectionLimit: 50,
    });
  });
});

describe('mergeHasMore', () => {
  // An empty page at offset zero of a list with any rows reads as having more.
  const zeroLimitAnswer = { hasMoreGroups: true, hasMoreSections: true };

  it('keeps a finished section list finished across a groups read', () => {
    expect(
      mergeHasMore(
        'groups',
        { ...zeroLimitAnswer, hasMoreGroups: false },
        { hasMoreGroups: true, hasMoreSections: false }
      )
    ).toEqual({ hasMoreGroups: false, hasMoreSections: false });
  });

  it('keeps a finished group list finished across a sections read', () => {
    expect(
      mergeHasMore(
        'sections',
        { ...zeroLimitAnswer, hasMoreSections: false },
        { hasMoreGroups: false, hasMoreSections: true }
      )
    ).toEqual({ hasMoreGroups: false, hasMoreSections: false });
  });

  it('keeps an unfinished list unfinished while the other is paged', () => {
    expect(
      mergeHasMore(
        'groups',
        { hasMoreGroups: true, hasMoreSections: false },
        { hasMoreGroups: true, hasMoreSections: true }
      )
    ).toEqual({ hasMoreGroups: true, hasMoreSections: true });
  });

  it('takes both answers from a read of both lists', () => {
    expect(
      mergeHasMore(
        'both',
        { hasMoreGroups: true, hasMoreSections: false },
        { hasMoreGroups: false, hasMoreSections: true }
      )
    ).toEqual({ hasMoreGroups: true, hasMoreSections: false });
  });
});
