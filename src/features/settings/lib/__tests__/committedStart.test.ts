/**
 * Scenario: the slider's ticks sit on local midnight, and the downloaded start
 * is a `YYYY-MM-DD` string.
 *
 * Expected behaviour: the committed start is that local midnight in every
 * zone, so a handle returned to it proposes no range.
 */
import { committedStart } from '../committedStart';

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('committedStart', () => {
  it('reads the synced start as a local day', () => {
    expect(committedStart('2024-01-01', null, false).getTime()).toBe(local(2024, 1, 1));
  });

  it('reads a locked start as a local day', () => {
    expect(committedStart('2024-01-01', '2023-06-01', true).getTime()).toBe(local(2024, 1, 1));
  });

  it('takes the older of the cache and the synced start, both local', () => {
    expect(committedStart('2024-01-01', '2023-06-15', false).getTime()).toBe(local(2023, 6, 15));
    expect(committedStart('2024-01-01', '2024-03-01', false).getTime()).toBe(local(2024, 1, 1));
  });
});
