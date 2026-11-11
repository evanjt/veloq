/**
 * Scenario: the stream window is changed from the settings row, and a change
 * that narrows it prunes saved series on the way in. Which changes narrow is
 * decided here, so the row can ask before the ones that delete.
 *
 * Expected behaviour: moving off keep-everything onto a bounded window narrows,
 * moving between bounded windows narrows only when the new one is shorter, and
 * a widening or a repeat never does.
 */

import { STREAM_RETENTION_ALL, narrowsStreamWindow } from '@/features/settings/lib/streamRetention';

describe('narrowsStreamWindow', () => {
  it('narrows from keep-everything onto a bounded window', () => {
    expect(narrowsStreamWindow(STREAM_RETENTION_ALL, 30)).toBe(true);
    expect(narrowsStreamWindow(STREAM_RETENTION_ALL, 365)).toBe(true);
  });

  it('narrows between bounded windows when the new one is shorter', () => {
    expect(narrowsStreamWindow(90, 30)).toBe(true);
    expect(narrowsStreamWindow(365, 180)).toBe(true);
  });

  it('does not narrow when the new window is wider', () => {
    expect(narrowsStreamWindow(30, 90)).toBe(false);
    expect(narrowsStreamWindow(180, 365)).toBe(false);
  });

  it('does not narrow when the window goes back to keep-everything', () => {
    expect(narrowsStreamWindow(30, STREAM_RETENTION_ALL)).toBe(false);
    expect(narrowsStreamWindow(STREAM_RETENTION_ALL, STREAM_RETENTION_ALL)).toBe(false);
  });

  it('does not narrow when the window stays the same', () => {
    expect(narrowsStreamWindow(90, 90)).toBe(false);
  });

  it('treats an off-list window as bounded when it is longer than the new one', () => {
    expect(narrowsStreamWindow(45, 30)).toBe(true);
    expect(narrowsStreamWindow(45, 90)).toBe(false);
  });
});
