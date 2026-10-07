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
        split_from: 'parent',
        version: 3,
      })
    );
    expect(d.around).toEqual(['a1', 'a2']);
    expect(d.forkAround).toEqual(['b1']);
    expect(d.prs).toEqual([{ sport: undefined, time: 412.5 }]);
    expect(d.siblings).toBe(2);
    expect(d.siblingIds).toEqual(['s1', 's2']);
    expect(d.splitFrom).toBe('parent');
    expect(d.version).toBe(3);
  });

  it('reads a re-based record', () => {
    const d = parseEventDetails(JSON.stringify({ from_time: 400, to_time: 520 }));
    expect(d.prFrom).toBe(400);
    expect(d.prTo).toBe(520);
    expect(d.prSport).toBeUndefined();
  });

  it('reads one record per sport from an era snapshot', () => {
    const d = parseEventDetails(
      JSON.stringify({
        prs: {
          Ride: { activity_id: 'b1', time: 65 },
          Run: { activity_id: 'r1', time: 250 },
          Walk: { activity_id: 'w1', time: 'slow' },
        },
      })
    );
    expect(d.prs).toEqual([
      { sport: 'Ride', time: 65 },
      { sport: 'Run', time: 250 },
    ]);
  });

  it('reads the sport a re-based record moved within', () => {
    const d = parseEventDetails(JSON.stringify({ sport: 'Run', from_time: 250, to_time: 240 }));
    expect(d.prSport).toBe('Run');
    expect(d.prFrom).toBe(250);
    expect(d.prTo).toBe(240);
  });

  it('reads resolved parent and child links from the engine ledger', () => {
    const d = parseEventDetails(
      JSON.stringify({
        split_from_link: { id: 'parent', name: 'Col de la Croix', available: true },
        split_into_links: [
          { id: 'child', name: 'Col de la Croix / 1', available: true },
          { id: 'missing', name: null, available: false },
        ],
      })
    );
    expect(d.splitFromLink).toEqual({ id: 'parent', name: 'Col de la Croix', available: true });
    expect(d.splitIntoLinks).toEqual([
      { id: 'child', name: 'Col de la Croix / 1', available: true },
      { id: 'missing', name: null, available: false },
    ]);
  });

  it('is empty for missing, malformed or wrongly typed details', () => {
    const empty = {
      around: [],
      forkAround: [],
      prs: [],
      siblings: 0,
      siblingIds: [],
      splitIntoLinks: [],
    };
    expect(parseEventDetails(undefined)).toEqual(empty);
    expect(parseEventDetails('{not json')).toEqual(empty);
    expect(parseEventDetails(JSON.stringify({ around: 'a1', pr_time: 'fast' }))).toEqual(empty);
  });
});
