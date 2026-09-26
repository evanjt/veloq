import {
  addRecording,
  type RecordingEntry,
} from '../../../modules/veloqrs/src/delegates/recordings';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

it('throws instead of reporting an existing recording when closed', () => {
  const host = { ready: false } as DelegateHost;
  expect(() => addRecording(host, { id: 'closed' } as RecordingEntry)).toThrow(
    'Engine not initialized'
  );
});

it('passes through inserted and existing answers when ready', () => {
  const insert = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
  const host = {
    ready: true,
    timed: (_name: string, operation: () => boolean) => operation(),
    engine: { recordings: () => ({ addRecording: insert }) },
  } as unknown as DelegateHost;
  const entry = { id: 'ready' } as RecordingEntry;
  expect(addRecording(host, entry)).toBe(true);
  expect(addRecording(host, entry)).toBe(false);
  expect(insert).toHaveBeenCalledTimes(2);
});
