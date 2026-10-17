import {
  tourFooterLayout,
  tourPictureScale,
  tourPictureSpace,
  tourSlideAreaHeight,
  tourSlideLayout,
  TOUR_PICTURE_FLOOR,
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

describe('tourSlideLayout', () => {
  it('scrolls the text and keeps the picture at its floor when the title and body outgrow the slide', () => {
    const layout = tourSlideLayout(300, 420, 200);
    expect(layout.scrolls).toBe(true);
    expect(layout.pictureScale).toBe(TOUR_PICTURE_FLOOR);
    expect(layout.pictureScale).toBeGreaterThan(0);
  });

  it('gives the scrolling text what the floored picture leaves, never a negative height', () => {
    const layout = tourSlideLayout(400, 600, 200);
    expect(layout.textHeight).toBe(400 - 24 - 24 - 200 * TOUR_PICTURE_FLOOR);
    expect(tourSlideLayout(100, 600, 400).textHeight).toBe(0);
  });

  it('draws everything at its own size without scrolling when it fits', () => {
    expect(tourSlideLayout(600, 200, 200)).toEqual({
      pictureScale: 1,
      scrolls: false,
      textHeight: undefined,
    });
  });

  it('shrinks the picture between the floor and its own size without scrolling', () => {
    const layout = tourSlideLayout(400, 200, 300);
    expect(layout.pictureScale).toBeGreaterThan(TOUR_PICTURE_FLOOR);
    expect(layout.pictureScale).toBeLessThan(1);
    expect(layout.scrolls).toBe(false);
  });

  it('fits the picture at the floor exactly, and scrolls one dp under it', () => {
    const exact = 24 + 200 + 24 + 200 * TOUR_PICTURE_FLOOR;
    expect(tourSlideLayout(exact, 200, 200)).toMatchObject({
      pictureScale: TOUR_PICTURE_FLOOR,
      scrolls: false,
    });
    expect(tourSlideLayout(exact - 1, 200, 200)).toMatchObject({
      pictureScale: TOUR_PICTURE_FLOOR,
      scrolls: true,
    });
  });

  it('neither scrolls nor shrinks before the title and body are laid out', () => {
    expect(tourSlideLayout(300, 0, 200)).toEqual({
      pictureScale: 1,
      scrolls: false,
      textHeight: undefined,
    });
  });

  it('scrolls text that outgrows the slide before the picture is measured', () => {
    expect(tourSlideLayout(300, 420, 0)).toMatchObject({ pictureScale: 1, scrolls: true });
  });
});

describe('tourFooterLayout', () => {
  it('keeps the three buttons in one row when they and the gaps between them fit', () => {
    expect(tourFooterLayout(248, { skip: 52, showMe: 96, next: 60 })).toBe('row');
  });

  it('stacks when the labels are longer than the row, as the German ones are on a narrow card', () => {
    expect(tourFooterLayout(208, { skip: 106, showMe: 100, next: 62 })).toBe('stacked');
  });

  it('stacks when the buttons fit end to end but leave no gap between them', () => {
    expect(tourFooterLayout(208, { skip: 52, showMe: 96, next: 60 })).toBe('stacked');
  });

  it('keeps the row at exactly the width of the buttons and their gaps, and stacks one dp under', () => {
    const exact = 52 + 96 + 60 + 2 * 8;
    expect(tourFooterLayout(exact, { skip: 52, showMe: 96, next: 60 })).toBe('row');
    expect(tourFooterLayout(exact - 1, { skip: 52, showMe: 96, next: 60 })).toBe('stacked');
  });

  it('counts one gap when the slide has no Show Me', () => {
    expect(tourFooterLayout(120, { skip: 52, showMe: 0, next: 60 })).toBe('row');
    expect(tourFooterLayout(119, { skip: 52, showMe: 0, next: 60 })).toBe('stacked');
  });

  it('keeps the row before the footer has been laid out, so the first frame does not stack', () => {
    expect(tourFooterLayout(0, { skip: 106, showMe: 100, next: 62 })).toBe('row');
  });
});
