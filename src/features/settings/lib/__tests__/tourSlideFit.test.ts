import {
  tourPictureScale,
  tourPictureSpace,
  tourSlideAreaHeight,
} from '@/features/settings/lib/tourSlideFit';

describe('tourSlideAreaHeight', () => {
  it('gives the slides what the card holds once the dots and buttons are placed', () => {
    expect(tourSlideAreaHeight(800, 100)).toBe(540);
  });

  it('gives nothing rather than a negative height when the chrome alone fills the card', () => {
    expect(tourSlideAreaHeight(100, 120)).toBe(0);
  });
});

describe('tourPictureSpace', () => {
  it('leaves the picture what the title and body do not take', () => {
    const space = tourPictureSpace(400, 150);
    expect(space).toBeLessThan(400 - 150);
    expect(space).toBeGreaterThan(0);
  });

  it('leaves nothing when the title and body alone fill the slide', () => {
    expect(tourPictureSpace(200, 260)).toBe(0);
  });
});

describe('tourPictureScale', () => {
  it('draws a picture at its own size when it fits', () => {
    expect(tourPictureScale(180, 300)).toBe(1);
    expect(tourPictureScale(180, 180)).toBe(1);
  });

  it('never enlarges a picture past its own size', () => {
    expect(tourPictureScale(100, 1000)).toBe(1);
  });

  it('shrinks a picture taller than its space to exactly that space', () => {
    expect(tourPictureScale(200, 150)).toBeCloseTo(0.75);
    expect(200 * tourPictureScale(200, 150)).toBeLessThanOrEqual(150);
  });

  it('shrinks to nothing when there is no space, and is never negative', () => {
    expect(tourPictureScale(200, 0)).toBe(0);
    expect(tourPictureScale(200, -20)).toBe(0);
  });

  it('leaves an unmeasured picture alone', () => {
    expect(tourPictureScale(0, 100)).toBe(1);
  });
});
