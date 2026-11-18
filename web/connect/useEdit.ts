// The edit a pane sends: through the shared write path, so the reads it names
// are asked again, with the engine's refusal kept for the pane to show.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { applyEdit, type Edit } from './routesEdits';
import { useWrite } from './useRead';

export type Editor = {
  run: (edit: Edit) => Promise<boolean>;
  refusal: string | null;
};

export function useEdit(): Editor {
  const { t } = useTranslation();
  const { run: sendWrite } = useWrite();
  const [refusal, setRefusal] = useState<string | null>(null);
  const run = useCallback(
    async (edit: Edit) => {
      const outcome = await applyEdit(
        async (method, params, options) =>
          (await sendWrite(method, params, options)).result as { ok: boolean },
        edit
      );
      setRefusal(
        outcome.ok
          ? null
          : outcome.notice
            ? t(outcome.notice)
            : outcome.refusal || t('connectPage.routes.editFailed')
      );
      return outcome.ok;
    },
    [sendWrite, t]
  );
  return { run, refusal };
}
