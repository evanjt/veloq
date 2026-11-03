import { sectionMetaStacks, sectionRowShowsRange } from '../sectionInlineRowLayout';

describe('sectionRowShowsRange', () => {
  it('keeps the range beside the plot on a wide row at the default text size', () => {
    expect(sectionRowShowsRange(375, 1)).toBe(true);
  });

  it('drops the range on a narrow row so the pace keeps its room', () => {
    expect(sectionRowShowsRange(300, 1)).toBe(false);
  });

  it('drops the range sooner at a larger text size', () => {
    const width = 360;

    expect(sectionRowShowsRange(width, 1)).toBe(true);
    expect(sectionRowShowsRange(width, 1.3)).toBe(false);
  });

  it('stops growing the pace past the dense cap', () => {
    expect(sectionRowShowsRange(400, 2)).toBe(sectionRowShowsRange(400, 1.3));
  });

  it('shows the range before the row has been measured', () => {
    expect(sectionRowShowsRange(undefined, 1.3)).toBe(true);
  });

  it('drops the range on a row with no width at all', () => {
    expect(sectionRowShowsRange(0, 1)).toBe(false);
  });
});

describe('sectionMetaStacks', () => {
  const beside = { leadWidth: 16, widestWord: 60 };

  it('keeps the line beside the pace while the column holds its widest word', () => {
    expect(sectionMetaStacks({ rowWidth: 375, showRange: false, ...beside })).toBe(false);
  });

  it('stacks the line when the column is narrower than its widest word', () => {
    expect(
      sectionMetaStacks({ rowWidth: 260, showRange: false, leadWidth: 16, widestWord: 120 })
    ).toBe(true);
  });

  it('gives a row with no leading badge the room of that badge', () => {
    const rowWidth = 260;
    const widestWord = 80;

    expect(sectionMetaStacks({ rowWidth, showRange: false, leadWidth: 16, widestWord })).toBe(true);
    expect(sectionMetaStacks({ rowWidth, showRange: false, leadWidth: 0, widestWord })).toBe(false);
  });

  it('stacks the line sooner while the range still prints beside the plot', () => {
    const withRange = sectionMetaStacks({
      rowWidth: 260,
      showRange: true,
      leadWidth: 16,
      widestWord: 60,
    });
    const withoutRange = sectionMetaStacks({
      rowWidth: 260,
      showRange: false,
      leadWidth: 16,
      widestWord: 60,
    });

    expect(withRange).toBe(true);
    expect(withoutRange).toBe(false);
  });

  it('keeps the line beside the pace until the row has been measured', () => {
    expect(sectionMetaStacks({ rowWidth: undefined, showRange: false, ...beside })).toBe(false);
    expect(
      sectionMetaStacks({ rowWidth: 260, showRange: false, leadWidth: 16, widestWord: 0 })
    ).toBe(false);
  });
});
