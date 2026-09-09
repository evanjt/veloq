/**
 * Scenario: the fetch-and-store thread runs to its end whatever the athlete
 * does. Leaving the screen or letting the download stall stops the poll and
 * nothing else, so Rust keeps taking the write lock and keeps spending
 * requests on a download nobody is waiting for.
 *
 * Expected behaviour: abandoning the poll tells Rust to stop. A download that
 * settled on its own is not cancelled, because there is nothing left to stop
 * and the flag belongs to whatever runs next.
 */

import { abandonDownload } from '@/features/routes/lib/gpsDownloadPoll';

it('stops the download when the screen stopped waiting for it', () => {
  const cancel = jest.fn();
  abandonDownload('cancelled', cancel);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('stops a download that has stopped reporting progress', () => {
  const cancel = jest.fn();
  abandonDownload('stalled', cancel);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('leaves a download that finished on its own alone', () => {
  const cancel = jest.fn();
  abandonDownload('settled', cancel);
  expect(cancel).not.toHaveBeenCalled();
});

it('survives a library too old to carry the cancel', () => {
  const missing = () => {
    throw new TypeError('cancelFetchAndStore is not a function');
  };
  expect(() => abandonDownload('cancelled', missing)).not.toThrow();
});
