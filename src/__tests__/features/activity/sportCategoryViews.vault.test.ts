import {
  SPORT_FAMILY_ICONS,
  SPORT_FAMILY_LABELS,
  SPORT_FAMILY_MEMBERS,
  SPORT_FAMILY_ORDER,
  getActivityCategory,
} from '@/shared/activity/sportCategories';

describe('sport family views', () => {
  it('draws the families in the engine stack order', () => {
    expect(SPORT_FAMILY_ORDER).toEqual([
      'Ride',
      'Winter',
      'Run',
      'Water',
      'Foot',
      'Strength',
      'Other',
    ]);
    expect(Object.keys(SPORT_FAMILY_ICONS)).toEqual(SPORT_FAMILY_ORDER);
    expect(Object.keys(SPORT_FAMILY_LABELS)).toEqual(SPORT_FAMILY_ORDER);
  });

  it('files each type under the family whose list names it', () => {
    for (const [family, types] of Object.entries(SPORT_FAMILY_MEMBERS)) {
      for (const type of types) expect(getActivityCategory(type)).toBe(family);
    }
    expect(getActivityCategory('IceSkate')).toBe('Winter');
    expect(getActivityCategory('Snowshoe')).toBe('Winter');
    expect(getActivityCategory('Hike')).toBe('Foot');
    expect(getActivityCategory('Swim')).toBe('Water');
    expect(getActivityCategory('InlineSkate')).toBe('Other');
  });

  it('files a type no family lists under Other', () => {
    expect(getActivityCategory('Floorball')).toBe('Other');
    expect(getActivityCategory('')).toBe('Other');
    expect(getActivityCategory('ride')).toBe('Other');
  });
});
