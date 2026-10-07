import { ledgerDate } from '@/features/routes/lib/sectionLedger';

describe('ledgerDate', () => {
  it('reads a SQLite UTC datetime and leaves an ISO string alone', () => {
    expect(ledgerDate('2026-08-28 05:44:09').toISOString()).toBe('2026-08-28T05:44:09.000Z');
    expect(ledgerDate('2026-08-28T05:44:09.000Z').toISOString()).toBe('2026-08-28T05:44:09.000Z');
  });
});
