// A group of writes sent as one edit: the reads are asked again once, after the
// last, and one toast offers one undo that sends the writes that take them back.
// A refusal stops the batch where it stands, shows the engine's text and leaves
// what was written to the undo.

import { useState } from 'react';

import type { Methods } from './schema';
import { useToast } from './ui';
import type { QueryClient } from './query';

export type Write = { method: keyof Methods; params: object };

/** The writes that take a batch back: fixed, or read off what the engine answered to each write. */
export type Undo = readonly Write[] | ((answers: readonly unknown[]) => readonly Write[]);

export type Batch = {
  /** The engine's refusal of the last batch, or null. */
  refusal: string | null;
  /**
   * Send `writes` in order. `message` is what the toast says, and `undo` the writes that take
   * them back, or a function of the answers when the engine says what a write changed; with
   * none, the toast has no undo. Resolves true when every write was accepted.
   */
  run: (
    writes: readonly Write[],
    message: string,
    undo: Undo,
    undoLabel: string
  ) => Promise<boolean>;
};

const NO_READS: readonly string[] = [];

async function sendAll(phone: QueryClient, writes: readonly Write[]): Promise<unknown[]> {
  const answers: unknown[] = [];
  for (const [at, write] of writes.entries()) {
    const last = at === writes.length - 1;
    // Only the last write asks the reads again; naming none for the others keeps the read count at one.
    const outcome = (await phone.write(
      write.method as never,
      write.params as never,
      (last ? undefined : { invalidates: NO_READS }) as never
    )) as { result?: { ok?: boolean } };
    if (outcome.result?.ok === false) throw new Error('');
    answers.push(outcome.result);
  }
  return answers;
}

export function useBatch(phone: QueryClient, failed: string): Batch {
  const toast = useToast();
  const [refusal, setRefusal] = useState<string | null>(null);
  return {
    refusal,
    async run(writes, message, undo, undoLabel) {
      if (writes.length === 0) return true;
      let answers: unknown[];
      try {
        answers = await sendAll(phone, writes);
      } catch (error) {
        setRefusal(error instanceof Error && error.message ? error.message : failed);
        return false;
      }
      setRefusal(null);
      const back = typeof undo === 'function' ? undo(answers) : undo;
      toast(
        message,
        back.length === 0
          ? undefined
          : {
              label: undoLabel,
              run: () => {
                void sendAll(phone, back).catch((error: unknown) =>
                  setRefusal(error instanceof Error && error.message ? error.message : failed)
                );
              },
            }
      );
      return true;
    },
  };
}
