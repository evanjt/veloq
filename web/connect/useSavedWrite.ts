// A write from a settings pane: sent through the shared write path, the reads
// it names asked again, a "Saved" toast with undo on success and the phone's
// own refusal kept for the pane to show.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Optimistic } from './query';
import { refusalText } from './link';
import { useToast } from './ui';
import { useWrite } from './useRead';

/** A write as the phone takes it. */
export type Change = { method: string; params: object };

export type SavedWrite = {
  /**
   * Send `change`. `previous` is the write that puts things back, offered as
   * the toast's undo. Resolves to whether the phone took it.
   */
  save: (
    change: Change,
    options?: { previous?: Change; optimistic?: readonly Optimistic[] }
  ) => Promise<boolean>;
  /** The phone's words for the write it refused last, or null. */
  refusal: string | null;
  clearRefusal: () => void;
};

export function useSavedWrite(invalidates: string[]): SavedWrite {
  const { t } = useTranslation();
  const { run } = useWrite();
  const toast = useToast();
  const [refusal, setRefusal] = useState<string | null>(null);
  const clearRefusal = useCallback(() => setRefusal(null), []);
  const key = invalidates.join('\n');
  const textOf = useCallback((error: unknown) => refusalText(error, t), [t]);

  const save = useCallback<SavedWrite['save']>(
    async (change, options = {}) => {
      const { previous, optimistic } = options;
      const reads = key.split('\n');
      try {
        const outcome = await run(change.method as 'settings.set', change.params as never, {
          invalidates: reads,
          ...(optimistic ? { optimistic } : {}),
          ...(previous
            ? { undo: () => ({ method: previous.method, params: previous.params }) }
            : {}),
        });
        setRefusal(null);
        const undo = outcome.undo;
        toast(
          t('connectPage.settings.toast.saved'),
          undo
            ? {
                label: t('connectPage.settings.toast.undo'),
                run: () => void undo().catch((error: unknown) => setRefusal(textOf(error))),
              }
            : undefined
        );
        return true;
      } catch (error) {
        setRefusal(textOf(error));
        return false;
      }
    },
    [run, toast, t, key, textOf]
  );
  return { save, refusal, clearRefusal };
}
