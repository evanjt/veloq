import { tourResumeMotion } from '@/features/settings/lib/tourResume';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

describe('tourResumeMotion', () => {
  it('reopens on the slide whose Show Me was used and slides to the next one', () => {
    expect(tourResumeMotion({ shownIndex: 2, resumeIndex: 3 }, false)).toEqual({
      openOn: 2,
      slideTo: 3,
    });
  });

  it('lands on the next slide directly when reduced motion is on', () => {
    expect(tourResumeMotion({ shownIndex: 2, resumeIndex: 3 }, true)).toEqual({
      openOn: 3,
      slideTo: null,
    });
  });

  it('stays put when Show Me was used on the last slide', () => {
    expect(tourResumeMotion({ shownIndex: 4, resumeIndex: 4 }, false)).toEqual({
      openOn: 4,
      slideTo: null,
    });
  });

  it('lands on the resume slide when no slide was shown', () => {
    expect(tourResumeMotion({ shownIndex: null, resumeIndex: 0 }, false)).toEqual({
      openOn: 0,
      slideTo: null,
    });
  });
});

describe('WhatsNewStore.showMe', () => {
  beforeEach(() => {
    useWhatsNewStore.setState({ tourState: null });
  });

  it('remembers the slide whose Show Me was used beside the one to resume on', () => {
    useWhatsNewStore.getState().startTour('tutorial');
    useWhatsNewStore.getState().showMe(1, 2, 'tip');
    useWhatsNewStore.getState().resumeTour();
    const motion = tourResumeMotion(useWhatsNewStore.getState().tourState!, false);
    expect(motion).toEqual({ openOn: 1, slideTo: 2 });
  });

  it('starts a tour with no slide shown', () => {
    useWhatsNewStore.getState().startTour('whatsNew');
    expect(useWhatsNewStore.getState().tourState!.shownIndex).toBeNull();
  });
});
