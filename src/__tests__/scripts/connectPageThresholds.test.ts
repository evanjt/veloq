/**
 * Scenario: the athlete edits a threshold figure in the browser's table, which
 * shows each value with where the phone got it.
 *
 * Expected behaviour: a changed positive number is the write that sets the
 * figure; a blank cell clears only a figure the athlete set; a value the
 * engine would refuse, or the value already shown, is no write; undo
 * restores the athlete's earlier figure, or clears when the earlier figure was
 * not theirs.
 */

import {
  SOURCE_KEYS,
  THRESHOLD_FIELDS,
  thresholdUndo,
  thresholdWrite,
  type Figure,
} from '../../../web/connect/thresholdSettings';

const FILE_FTP: Figure = { field: 'ftp', value: 240, source: 'file' };
const OWN_FTP: Figure = { field: 'ftp', value: 262, source: 'athlete' };
const NO_FTP: Figure = { field: 'ftp', value: null, source: null };

describe('thresholdWrite', () => {
  it('sets a changed positive number for the sport and field', () => {
    expect(thresholdWrite(FILE_FTP, 'Ride', '255')).toEqual({
      ok: true,
      method: 'settings.setThreshold',
      params: { sport: 'Ride', field: 'ftp', value: 255 },
    });
  });

  it('sets a figure no source gives yet', () => {
    expect(thresholdWrite(NO_FTP, 'Run', ' 301.5 ')).toEqual({
      ok: true,
      method: 'settings.setThreshold',
      params: { sport: 'Run', field: 'ftp', value: 301.5 },
    });
  });

  it('clears a figure the athlete set when the cell is blank', () => {
    expect(thresholdWrite(OWN_FTP, 'Ride', '  ')).toEqual({
      ok: true,
      method: 'settings.setThreshold',
      params: { sport: 'Ride', field: 'ftp', value: null },
    });
  });

  it('writes nothing for a blank cell over a figure the athlete did not set', () => {
    expect(thresholdWrite(FILE_FTP, 'Ride', '')).toEqual({ ok: false, error: null });
    expect(thresholdWrite(NO_FTP, 'Ride', '')).toEqual({ ok: false, error: null });
  });

  it('writes nothing for the value already shown', () => {
    expect(thresholdWrite(FILE_FTP, 'Ride', '240')).toEqual({ ok: false, error: null });
    expect(thresholdWrite(OWN_FTP, 'Ride', '262.0')).toEqual({ ok: false, error: null });
  });

  it.each(['0', '-5', 'abc', 'Infinity', '12 W'])('refuses %p with the page words', (raw) => {
    expect(thresholdWrite(FILE_FTP, 'Ride', raw)).toEqual({
      ok: false,
      error: 'connectPage.settings.thresholds.invalid',
    });
  });
});

describe('thresholdUndo', () => {
  it("restores the athlete's earlier figure", () => {
    expect(thresholdUndo('Ride', OWN_FTP)).toEqual({
      method: 'settings.setThreshold',
      params: { sport: 'Ride', field: 'ftp', value: 262 },
    });
  });

  it('clears when the earlier figure came from the files or the account', () => {
    for (const source of ['file', 'sportSettings'] as const) {
      expect(thresholdUndo('Ride', { ...FILE_FTP, source })).toEqual({
        method: 'settings.setThreshold',
        params: { sport: 'Ride', field: 'ftp', value: null },
      });
    }
    expect(thresholdUndo('Run', NO_FTP).params.value).toBeNull();
  });
});

describe('the table words', () => {
  it('names every figure the engine offers and every source it gives', () => {
    expect(THRESHOLD_FIELDS.map((entry) => entry.field)).toEqual([
      'ftp',
      'thresholdHr',
      'maxHr',
      'restingHr',
      'weightKg',
    ]);
    expect(Object.keys(SOURCE_KEYS).sort()).toEqual(['athlete', 'file', 'sportSettings']);
  });
});
