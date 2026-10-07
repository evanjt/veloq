import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
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
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

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
  const ledger = useSectionLedger(id, refreshKey, bundledLedger);
  const activityNames = useLedgerActivityNames(ledger.history);
  const revert = useCallback(
    (version: number) => {
      Alert.alert(t('sectionHistory.revert'), t('sectionHistory.revertConfirm', { version }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sectionHistory.revert'),
          onPress: () => {
            if (ledger.revert(version)) refresh();
          },
        },
      ]);
    },
    [ledger, refresh, t]
  );
  const unpin = useCallback(() => {
    if (ledger.unpin()) refresh();
  }, [ledger, refresh]);
  const showVersion = useCallback(
    (version: number | null) => {
      if (version === null) return;
      router.push({ pathname: '/section/[id]', params: { id, previewVersion: String(version) } });
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
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHistoryPanel
          isDark={isDark}
          history={ledger.history}
          versions={ledger.versions}
          pinnedVersion={ledger.pinnedVersion}
          shownVersion={null}
          onShowVersion={showVersion}
          onRevert={revert}
          onUnpin={unpin}
          activityNames={activityNames}
          failureKey={ledger.failureKey}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenDark: { backgroundColor: darkColors.background },
  content: { padding: layout.screenPadding, paddingBottom: spacing.xl },
});

export default withScreenBoundary(SectionHistoryScreenContent, 'Section History');
