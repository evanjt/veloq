import { sportChipOrder } from '../sportChipOrder';

const counts = [
  { category: 'Ride', count: 12 },
  { category: 'Run', count: 30 },
  { category: 'Swim', count: 0 },
];
const order = (chosen: string[], categories = counts) =>
  sportChipOrder(categories, chosen).map(({ category }) => category);

describe('sportChipOrder', () => {
  it('puts a chosen sport first and the rest by count', () => {
    expect(order(['Ride'])).toEqual(['Ride', 'Run', 'Swim']);
  });

  it('orders by count with none chosen', () => {
    expect(order([])).toEqual(['Run', 'Ride', 'Swim']);
  });

  it('leads with two chosen sports in the order they were chosen', () => {
    expect(order(['Swim', 'Ride'])).toEqual(['Swim', 'Ride', 'Run']);
    expect(order(['Ride', 'Swim'])).toEqual(['Ride', 'Swim', 'Run']);
  });

  it('keeps a chosen sport in front when a period change moves the counts', () => {
    const later = [
      { category: 'Ride', count: 0 },
      { category: 'Run', count: 4 },
      { category: 'Swim', count: 9 },
    ];
    expect(order(['Ride'], later)).toEqual(['Ride', 'Swim', 'Run']);
  });

  it('keeps each count with its sport', () => {
    expect(sportChipOrder(counts, ['Swim'])).toEqual([
      { category: 'Swim', count: 0 },
      { category: 'Run', count: 30 },
      { category: 'Ride', count: 12 },
    ]);
  });

  it('gives an empty row for an empty library', () => {
    expect(sportChipOrder([], [])).toEqual([]);
  });

  it('keeps a chosen sport the library no longer holds, so it can be cleared', () => {
    expect(sportChipOrder(counts, ['Walk'])).toEqual([
      { category: 'Walk', count: 0 },
      { category: 'Run', count: 30 },
      { category: 'Ride', count: 12 },
      { category: 'Swim', count: 0 },
    ]);
  });
});
