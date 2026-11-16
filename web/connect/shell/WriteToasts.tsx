// The toast host for writes. Each write the phone answers with a notice shows
// it as a toast; a toast whose write offers an undo carries that undo as its
// button. Mounted once, under the query provider, so every page's writes reach
// it.

import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useQueries } from '../useRead';
import { ToastProvider, useToast } from '../ui';

export function WriteToasts({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ToastProvider dismissLabel={t('common.close')}>
      <WriteNotices />
      {children}
    </ToastProvider>
  );
}

function WriteNotices() {
  const { t } = useTranslation();
  const queries = useQueries();
  const notify = useToast();
  useEffect(
    () =>
      queries.onWrite((event) => {
        if (event.error !== null || event.notice === undefined || event.undo === null) return;
        const undo = event.undo;
        notify(t(event.notice), {
          label: t('common.undo'),
          // A failed undo is reported on the page's notice by the query layer, so the rejection stops here.
          run: () => {
            undo().catch(() => undefined);
          },
        });
      }),
    [queries, notify, t]
  );
  return null;
}
