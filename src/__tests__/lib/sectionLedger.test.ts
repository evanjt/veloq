import { ledgerDate, parseEventDetails } from '@/features/routes/lib/sectionLedger';

describe('ledgerDate', () => {
  it('reads a SQLite UTC datetime and leaves an ISO string alone', () => {
    expect(ledgerDate('2026-08-28 05:44:09').toISOString()).toBe('2026-08-28T05:44:09.000Z');
    expect(ledgerDate('2026-08-28T05:44:09.000Z').toISOString()).toBe('2026-08-28T05:44:09.000Z');
  });
});

describe('parseEventDetails', () => {
  it('reads what was around a change, the PR era and the lineage', () => {
    const d = parseEventDetails(
      JSON.stringify({
        around: ['a1', 'a2'],
        fork_around: ['b1'],
        pr_time: 412.5,
        siblings: ['s1', 's2'],
        version: 3,
      })
    );
    expect(d.around).toEqual(['a1', 'a2']);
    expect(d.forkAround).toEqual(['b1']);
    expect(d.prTime).toBe(412.5);
    expect(d.siblings).toBe(2);
    expect(d.version).toBe(3);
  });

  it('reads a re-based record', () => {
    const d = parseEventDetails(JSON.stringify({ from_time: 400, to_time: 520 }));
    expect(d.prFrom).toBe(400);
    expect(d.prTo).toBe(520);
  });

  it('is empty for missing, malformed or wrongly typed details', () => {
    const empty = { around: [], forkAround: [], siblings: 0 };
    expect(parseEventDetails(undefined)).toEqual(empty);
    expect(parseEventDetails('{not json')).toEqual(empty);
    expect(parseEventDetails(JSON.stringify({ around: 'a1', pr_time: 'fast' }))).toEqual(empty);
  });
});
