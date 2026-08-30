/**
 * The names a user gave to sections. A name is keyed to ground, not to a
 * section id, so it survives a re-cut and goes dormant when nothing visible
 * covers that ground. This screen is the only place a name can be seen as a
 * name, and the only place one can be taken back.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { useNamedCorridors, type NamedCorridor } from '@/features/routes/hooks/useNamedCorridors';
import { getAllSectionDisplayNames } from '@/features/routes/lib/sectionDisplayNames';
import { ledgerDate } from '@/features/routes/lib/sectionLedger';
import { projectRouteToBox } from '@/shared/geo/routePreview';
import { getIntlLocale } from '@/shared/format/format';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

const PREVIEW_WIDTH = 64;
const PREVIEW_HEIGHT = 44;

function FootprintPreview({
  footprint,
  isDark,
}: {
  footprint: NamedCorridor['footprint'];
  isDark: boolean;
}) {
  const points = useMemo(
    () => projectRouteToBox(footprint, PREVIEW_WIDTH, PREVIEW_HEIGHT, 4),
    [footprint]
  );
  if (points.length === 0) return null;
  return (
    <Svg width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}>
      <Polyline
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={isDark ? darkColors.textSecondary : colors.primary}
        strokeWidth={2}
      />
    </Svg>
  );
}

export default function NamedCorridorsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const locale = getIntlLocale();
  const { corridors, remove } = useNamedCorridors();

  const sectionNames = useMemo(() => getAllSectionDisplayNames(), []);

  const confirmRemove = (corridor: NamedCorridor) => {
    Alert.alert(
      t('namedCorridors.deleteTitle'),
      t('namedCorridors.deleteConfirm', { name: corridor.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('namedCorridors.delete'),
          style: 'destructive',
          onPress: () => remove(corridor.intentId),
        },
      ]
    );
  };

  return (
    <ScreenErrorBoundary screenName="Named Corridors">
      <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <TouchableOpacity
            testID="named-corridors-back"
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel={t('common.back')}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? darkColors.textPrimary : colors.textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.title, isDark && styles.textDark]}>{t('namedCorridors.title')}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content} testID="named-corridors-list">
          {corridors.length === 0 ? (
            <Text
              testID="named-corridors-empty"
              style={[styles.empty, isDark && styles.textMutedDark]}
            >
              {t('namedCorridors.empty')}
            </Text>
          ) : (
            corridors.map((corridor) => (
              <View
                key={corridor.intentId}
                style={[styles.card, isDark && styles.cardDark]}
                testID={`named-corridor-${corridor.intentId}`}
              >
                <View style={styles.row}>
                  <FootprintPreview footprint={corridor.footprint} isDark={isDark} />
                  <View style={styles.body}>
                    <Text style={[styles.name, isDark && styles.textDark]}>{corridor.name}</Text>
                    <Text style={[styles.meta, isDark && styles.textMutedDark]}>
                      {t('namedCorridors.created', {
                        date: ledgerDate(corridor.createdAt).toLocaleDateString(locale, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        }),
                      })}
                    </Text>
                    {corridor.dormant ? (
                      <Text
                        testID={`named-corridor-${corridor.intentId}-dormant`}
                        style={[styles.meta, isDark && styles.textMutedDark]}
                      >
                        {t('namedCorridors.dormant')}
                      </Text>
                    ) : (
                      <TouchableOpacity
                        testID={`named-corridor-${corridor.intentId}-open`}
                        onPress={() => router.push(`/section/${corridor.sectionId}`)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.link}>
                          {t('namedCorridors.onSection', {
                            name: sectionNames[corridor.sectionId ?? ''] ?? corridor.sectionId,
                            percent: Math.round(corridor.coverage * 100),
                          })}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {!corridor.dormant && !corridor.primary && (
                      <Text
                        testID={`named-corridor-${corridor.intentId}-secondary`}
                        style={[styles.meta, isDark && styles.textMutedDark]}
                      >
                        {t('namedCorridors.secondary')}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    testID={`named-corridor-${corridor.intentId}-delete`}
                    onPress={() => confirmRemove(corridor)}
                    style={styles.deleteButton}
                    accessibilityLabel={t('namedCorridors.delete')}
                  >
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={20}
                      color={colors.error}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  containerDark: { backgroundColor: darkColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  backButton: { width: layout.minTapTarget, height: layout.minTapTarget, justifyContent: 'center' },
  title: { ...typography.screenTitle, color: colors.textPrimary },
  content: { padding: layout.screenPadding, paddingBottom: TAB_BAR_SAFE_PADDING, gap: spacing.sm },
  card: {
    padding: layout.cardPadding,
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
  },
  cardDark: { backgroundColor: darkColors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  body: { flex: 1, gap: spacing.xs },
  deleteButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...typography.body, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.bodySmall, color: colors.primary },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  textDark: { color: darkColors.textPrimary },
  textMutedDark: { color: darkColors.textSecondary },
});
