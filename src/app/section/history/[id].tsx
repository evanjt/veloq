import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/app';
import {
  DetailFallback,
  SectionHistoryPanel,
  useLedgerActivityNames,
  useSectionDetailData,
  useSectionLedger,
} from '@/features/routes';
import { colors, darkColors, layout, spacing } from '@/theme';
import { ScreenScrollView } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { tapTo } from '@/shared/app/navigation';

function SectionHistoryScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
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
      Alert.alert(t('sectionHistory.revert'), t('sectionHistory.revertConfirm', { version }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sectionHistory.revert'),
          onPress: async () => {
            if (await ledger.revert(version)) refresh();
          },
        },
      ]);
    },
    [ledger, refresh, t]
  );
  const unpin = useCallback(() => {
    if (ledger.isReverting) return;
    if (ledger.unpin()) refresh();
  }, [ledger, refresh]);
  const showVersion = useCallback(
    (version: number | null) => {
      if (version === null) return;
      tapTo({ pathname: '/section/[id]', params: { id, previewVersion: String(version) } });
    },
    [id]
  );

  if (!detail?.section) {
    return (
      <DetailFallback
        isDark={isDark}
        insetTop={insets.top}
        status={status}
        loading={status.kind === 'closed'}
        onRetry={refresh}
        notFoundMessage={t('sections.sectionNotFound')}
      />
    );
  }

  return (
    <View style={[styles.screen, isDark && styles.screenDark]}>
      <ScreenScrollView contentContainerStyle={styles.content}>
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
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenDark: { backgroundColor: darkColors.background },
  content: { padding: layout.screenPadding, paddingBottom: spacing.xl },
});

export default withScreenBoundary(SectionHistoryScreenContent, 'Section History');
