import { ringsLeavingView } from '@/features/activity/lib/ringsLeavingView';

describe('ringsLeavingView', () => {
  it('dismisses a new card after it was seen and leaves', () => {
    const seen = new Set<string>();
    const newIds = new Set(['new-card']);

    expect(ringsLeavingView([{ key: 'new-card', isViewable: true }], seen, newIds)).toEqual([]);
    expect(ringsLeavingView([{ key: 'new-card', isViewable: false }], seen, newIds)).toEqual([
      'new-card',
    ]);
    expect(ringsLeavingView([{ key: 'new-card', isViewable: false }], seen, newIds)).toEqual([]);
  });

  it('keeps the ring when a new card leaves without being seen', () => {
    expect(
      ringsLeavingView(
        [{ key: 'unseen-card', isViewable: false }],
        new Set<string>(),
        new Set(['unseen-card'])
      )
    ).toEqual([]);
  });

  it('never dismisses a card outside the new set', () => {
    const seen = new Set<string>();
    const newIds = new Set(['other-card']);

    expect(ringsLeavingView([{ key: 'ordinary-card', isViewable: true }], seen, newIds)).toEqual(
      []
    );
    expect(ringsLeavingView([{ key: 'ordinary-card', isViewable: false }], seen, newIds)).toEqual(
      []
    );
  });
});
