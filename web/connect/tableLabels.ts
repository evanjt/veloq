// The words every connect table shows around its rows, translated.

import { useTranslation } from 'react-i18next';

import type { TableLabels } from './ui/DataTable';

export function useTableLabels(): TableLabels {
  const { t } = useTranslation();
  return {
    count: (rows) => t('connectPage.table.count', { count: rows }),
    selected: (count) => t('connectPage.table.selected', { count }),
    clearSelection: t('connectPage.table.clearSelection'),
    selectAll: t('connectPage.table.selectAll'),
    columns: t('connectPage.table.columns'),
  };
}
