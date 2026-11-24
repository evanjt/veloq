import { seasonChange } from '@/features/stats/lib/periodWindows';

describe('seasonChange', () => {
  vaultIt.each([0, 0.3, -0.3, 0.49, -0.49])(
    'prints a %s% change as 0% on the neutral rung',
    (pct) => {
      expect(seasonChange('hours', pct)).toEqual({ text: '0%', rung: 'neutral' });
    }
  );

  it('signs a rise and a fall once rounded', () => {
    expect(seasonChange('hours', 12.4)).toEqual({ text: '+12%', rung: 'positive' });
    expect(seasonChange('distance', -50)).toEqual({ text: '-50%', rung: 'negative' });
    expect(seasonChange('hours', 0.5)).toEqual({ text: '+1%', rung: 'positive' });
  });

  vaultIt('draws load, which moves with no judgement, on the neutral rung either way', () => {
    expect(seasonChange('tss', 30)).toEqual({ text: '+30%', rung: 'neutral' });
    expect(seasonChange('tss', -30)).toEqual({ text: '-30%', rung: 'neutral' });
  });
});
