import { listCountLabel } from '@/features/routes/lib/listCountLabel';

const t = (key: string, opts?: Record<string, unknown>) => {
  const strings: Record<string, string> = {
    'trainingScreen.countOfTotal': '{{shown}} of {{total}}',
  };
  return (strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k]));
};

describe('listCountLabel', () => {
  it('reads the total alone when nothing narrows the list', () => {
    expect(listCountLabel(t as never, 'Routes', 42, 42)).toBe('42 Routes');
  });

  it('reads the shown count of the total when a search narrows the list', () => {
    expect(listCountLabel(t as never, 'Routes', 1, 42)).toBe('1 of 42 Routes');
  });

  it('reads zero of the total when the search matches nothing', () => {
    expect(listCountLabel(t as never, 'Sections', 0, 50)).toBe('0 of 50 Sections');
  });
});
