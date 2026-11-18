// A group of writes sent as one edit: the reads are asked again once, after the
// last, and one toast offers one undo that sends the writes that take them back.
// A refusal stops the batch where it stands and shows the engine's text: with writes
// already accepted the toast says it and its undo takes back those writes only.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { refusalText } from './link';
import type { Methods } from './schema';
import { useToast } from './ui';
import { UNLESS_STORED, type Matcher, type QueryClient } from './query';

export type Write = { method: keyof Methods; params: object };

/** The writes that take a batch back: fixed, or read off what the engine answered to each write. */
export type Undo = readonly Write[] | ((answers: readonly unknown[]) => readonly Write[]);

export type Batch = {
  /** The engine's refusal of the last batch, or null. */
  refusal: string | null;
  /**
   * Send `writes` in order. `message` is what the toast says, and `undo` the writes that take
   * them back, or a function of the answers when the engine says what a write changed; with
   * none, the toast has no undo. Resolves true when every write was accepted. On a refusal it
   * resolves false and, when some writes were accepted, the toast carries the refusal and an
   * undo of those writes only.
   */
  run: (
    writes: readonly Write[],
    message: string,
    undo: Undo,
    undoLabel: string
  ) => Promise<boolean>;
};

const NO_READS: readonly string[] = [];

/** What a batch managed: the answers of the writes accepted, in order, and the refusal that stopped it. */
type Sent = { answers: unknown[]; refused: Error | null };

async function sendAll(
  phone: QueryClient,
  writes: readonly Write[],
  reads: Matcher
): Promise<Sent> {
  const answers: unknown[] = [];
  let refused: Error | null = null;
  for (const write of writes) {
    try {
      // No write names reads: the batch asks them again once, after the loop.
      const outcome = (await phone.write(
        write.method as never,
        write.params as never,
        { invalidates: NO_READS } as never
      )) as { result?: { ok?: boolean } };
      if (outcome.result?.ok === false) {
        refused = new Error('');
        break;
      }
      answers.push(outcome.result);
    } catch (error) {
      refused = error instanceof Error ? error : new Error(String(error));
      break;
    }
  }
  // What was written changed the library, also when a later write was refused.
  if (answers.length > 0) phone.invalidate(reads);
  return { answers, refused };
}

/**
 * `reads` names what is asked again after the writes: everything but a stored series unless a
 * page lists the few reads its writes change.
 */
export function useBatch(
  phone: QueryClient,
  failed: string,
  reads: Matcher = UNLESS_STORED
): Batch {
  const toast = useToast();
  const { t } = useTranslation();
  const [refusal, setRefusal] = useState<string | null>(null);
  const textOf = (error: Error) => refusalText(error, t) || failed;
  return {
    refusal,
    async run(writes, message, undo, undoLabel) {
      if (writes.length === 0) return true;
      const { answers, refused } = await sendAll(phone, writes, reads);
      // A fixed list is cut to the writes accepted, and a function is given those answers only.
      const takenBack = () =>
        typeof undo === 'function' ? undo(answers) : undo.slice(0, answers.length);
      if (refused) {
        setRefusal(textOf(refused));
        if (answers.length > 0) {
          toast(textOf(refused), undoOf(takenBack(), undoLabel));
        }
        return false;
      }
      setRefusal(null);
      toast(message, undoOf(takenBack(), undoLabel));
      return true;
    },
  };

  function undoOf(back: readonly Write[], label: string) {
    return back.length === 0
      ? undefined
      : {
          label,
          run: () => {
            void sendAll(phone, back, reads).then(({ refused }) => {
              if (refused) setRefusal(textOf(refused));
            });
          },
        };
  }
}
