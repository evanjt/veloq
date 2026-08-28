import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';

const t = (key: string, params?: Record<string, string | number>) =>
  params?.name ? `${key}:${params.name}` : key;

const NOW = 1_800_000_000_000;

describe('generateSectionChangedInsights', () => {
  it('points at the section, newest change first, one per section', () => {
    const insights = generateSectionChangedInsights(
      [
        { sectionId: 's1', sectionName: 'Berg', kind: 'recut', at: NOW - 1000 },
        { sectionId: 's1', sectionName: 'Berg', kind: 'split', at: NOW - 5000 },
        { sectionId: 's2', sectionName: 'Col', kind: 'reverted', at: NOW - 2000 },
      ],
      NOW,
      t
    );
    expect(insights.map((i) => i.navigationTarget)).toEqual(['/section/s1', '/section/s2']);
    expect(insights[0].subtitle).toBe('insights.sectionChanged.recut');
    expect(insights[0].title).toBe('insights.sectionChanged.title:Berg');
    expect(insights[0].category).toBe('section_changed');
    expect(insights[0].meta?.sourceTimestamp).toBe(NOW - 1000);
  });

  it('ignores kinds that are not a visible change and empty input', () => {
    expect(generateSectionChangedInsights([], NOW, t)).toEqual([]);
    expect(
      generateSectionChangedInsights(
        [{ sectionId: 's1', sectionName: 'Berg', kind: 'pr_rebased', at: NOW }],
        NOW,
        t
      )
    ).toEqual([]);
  });
});
