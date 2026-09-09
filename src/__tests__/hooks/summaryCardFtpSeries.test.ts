/**
 * Scenario: the summary card took the FTP it shows from the athlete's
 * configured setting and the value it compares against from the trend, so the
 * delta measured one series against another. On the measured account the
 * setting has held one value for five years while the daily model estimate
 * moved every few days, which is exactly when the two disagree.
 *
 * Expected behaviour: the number and its arrow come from one series. The
 * configured setting stays where a setting is what is meant.
 */

import { summaryCardFtp } from '@/features/home/lib/summaryCardFtp';

describe('the summary card FTP', () => {
  it('reports the trend it also compares, not the setting', () => {
    const ftp = summaryCardFtp({
      trend: { latestFtp: 141, previousFtp: 148 },
      configuredFtp: 155,
    });

    expect(ftp.value).toBe(141);
    expect(ftp.previous).toBe(148);
  });

  it('shows nothing rather than a setting the arrow cannot describe', () => {
    const ftp = summaryCardFtp({
      trend: { latestFtp: null, previousFtp: null },
      configuredFtp: 155,
    });

    expect(ftp.value).toBeNull();
    expect(ftp.previous).toBeNull();
  });

  it('shows the value with no arrow when the history is shorter than the window', () => {
    const ftp = summaryCardFtp({
      trend: { latestFtp: 141, previousFtp: null },
      configuredFtp: 155,
    });

    expect(ftp.value).toBe(141);
    expect(ftp.previous).toBeNull();
  });

  it('never mixes the two, whatever the setting says', () => {
    for (const configured of [null, 0, 155, 400]) {
      const ftp = summaryCardFtp({
        trend: { latestFtp: 141, previousFtp: 148 },
        configuredFtp: configured,
      });
      expect(ftp.value).toBe(141);
      expect(ftp.previous).toBe(148);
    }
  });
});
