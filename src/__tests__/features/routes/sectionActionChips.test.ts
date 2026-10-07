import { sectionActionChips } from '@/features/routes/lib/sectionActionChips';

describe('sectionActionChips', () => {
  it('offers Accept on an unpinned, unaccepted auto section', () => {
    expect(
      sectionActionChips({ sectionType: 'auto', isUserDefined: false, pinnedVersion: null })
    ).toEqual({ accept: 'offer', pinned: false });
  });

  it('shows only the pinned state when the section is pinned', () => {
    expect(
      sectionActionChips({ sectionType: 'auto', isUserDefined: false, pinnedVersion: 1 })
    ).toEqual({ accept: 'none', pinned: true });
  });

  it('replaces the accepted chip with the pinned one for a pinned named section', () => {
    expect(
      sectionActionChips({ sectionType: 'auto', isUserDefined: true, pinnedVersion: 2 })
    ).toEqual({ accept: 'none', pinned: true });
  });

  it('shows the accepted chip for an accepted section that is not pinned', () => {
    expect(
      sectionActionChips({ sectionType: 'auto', isUserDefined: true, pinnedVersion: null })
    ).toEqual({ accept: 'accepted', pinned: false });
  });

  it('shows no accept state for a custom section', () => {
    expect(
      sectionActionChips({ sectionType: 'custom', isUserDefined: true, pinnedVersion: null })
    ).toEqual({ accept: 'none', pinned: false });
  });
});
