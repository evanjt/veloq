import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useOpenDetail } from '@/shared/app/MapSheetCards';
import { confirmAction } from '@/shared/ui/dialog';
import { DetailFallback } from '../components';
import { SectionHistoryPanel } from '../components/section';
import { useLedgerActivityNames } from '../hooks/useLedgerActivityNames';
import { useSectionDetailData } from '../hooks/useSectionDetailData';
import { useSectionLedger } from '../hooks/useSectionLedger';
import { SheetCardScroll, type CardScrollProps } from './SheetCardScroll';

export interface SectionHistoryCardProps {
  /** The section's id. */
  id: string;
  /** The scroll the body sits in: the sheet's, unless the route passes its screen's. */
  Scroll?: React.ComponentType<CardScrollProps>;
}

/** A section's history: the versions of its line, what changed it, and the activities each holds. */
export function SectionHistoryCard({ id, Scroll = SheetCardScroll }: SectionHistoryCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const { data: detail, status } = useSectionDetailData(id, refreshKey);
  const bundledLedger = useMemo(
    () =>
      detail
        ? {
            history: detail.history,
            geometryVersions: detail.geometryVersions,
            pinnedVersion: detail.pinnedVersion,
          }
        : undefined,
    [detail]
  );
  const ledger = useSectionLedger(id, bundledLedger);
  const activityNames = useLedgerActivityNames(ledger.history);
  const revert = useCallback(
    (version: number) => {
      if (ledger.isReverting) return;
      confirmAction({
        title: t('sectionHistory.revert'),
        message: t('sectionHistory.revertConfirm', { version }),
        confirmLabel: t('sectionHistory.revert'),
        cancelLabel: t('common.cancel'),
        onConfirm: async () => {
          if (await ledger.revert(version)) refresh();
        },
      });
    },
    [ledger, refresh, t]
  );
  const unpin = useCallback(() => {
    if (ledger.isReverting) return;
    if (ledger.unpin()) refresh();
  }, [ledger, refresh]);
  const openDetail = useOpenDetail();
  const showVersion = useCallback(
    (version: number | null) => {
      if (version === null) return;
      openDetail({ kind: 'section', id, params: { previewVersion: String(version) } });
    },
    [id, openDetail]
  );

  if (!detail?.section) {
    return (
      <DetailFallback
        isDark={isDark}
        status={status}
        onRetry={refresh}
        notFoundMessage={t('sections.sectionNotFound')}
      />
    );
  }

  return (
    <Scroll>
      <SectionHistoryPanel
        isDark={isDark}
        history={ledger.history}
        versions={ledger.versions}
        pinnedVersion={ledger.pinnedVersion}
        shownVersion={null}
        onShowVersion={showVersion}
        onRevert={revert}
        onUnpin={unpin}
        isReverting={ledger.isReverting}
        activityNames={activityNames}
      />
    </Scroll>
  );
}
