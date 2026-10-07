import { ACTIVITY_CATEGORIES, FEED_GROUPS } from '@/shared/activity/sportCategories';

describe('sport category views', () => {
  it('assigns every fine category to one feed group, including Walk under Other', () => {
    expect(ACTIVITY_CATEGORIES.Walk.coarseGroup).toBe('Other');
    expect(Object.values(ACTIVITY_CATEGORIES).map((category) => category.coarseGroup)).toEqual(
      expect.arrayContaining(FEED_GROUPS)
    );
    for (const category of Object.values(ACTIVITY_CATEGORIES)) {
      expect(FEED_GROUPS).toContain(category.coarseGroup);
    }
  });
});
