import React from 'react';
import { View, TextInput, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';
import { StyleSheet } from 'react-native';

interface SectionsListHeaderProps {
  searchQuery: string;
  onSearchChange: (text: string) => void;
  displaySectionCount: number;
  unacceptedAutoCount: number;
  acceptAllResult: number | null;
  isScanning: boolean;
  onAcceptAll: () => void;
  onRescan: () => void;
}

export function SectionsListHeader({
  searchQuery,
  onSearchChange,
  displaySectionCount,
  unacceptedAutoCount,
  acceptAllResult,
  isScanning,
  onAcceptAll,
  onRescan,
}: SectionsListHeaderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <>
      <View style={[styles.searchContainer, isDark && styles.searchContainerDark]}>
        <MaterialCommunityIcons
          name="magnify"
          size={18}
          color={isDark ? darkColors.textDisabled : colors.textDisabled}
        />
        <TextInput
          style={[styles.searchInput, isDark && styles.searchInputDark]}
          placeholder={t('routes.searchSections')}
          placeholderTextColor={isDark ? darkColors.textDisabled : colors.textDisabled}
          value={searchQuery}
          onChangeText={onSearchChange}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => onSearchChange('')} hitSlop={8}>
            <MaterialCommunityIcons
              name="close-circle"
              size={16}
              color={isDark ? darkColors.textDisabled : colors.textDisabled}
            />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.countRow}>
        <Text style={[styles.summaryText, isDark && styles.summaryTextDark]}>
          {displaySectionCount} {t('trainingScreen.sections')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {unacceptedAutoCount > 0 && (
            <TouchableOpacity
              onPress={onAcceptAll}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <MaterialCommunityIcons name="pin-outline" size={13} color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.primary }}>
                {t('sections.acceptAllSections')}
              </Text>
            </TouchableOpacity>
          )}
          {acceptAllResult !== null && (
            <Text
              style={{
                fontSize: 11,
                color: isDark ? darkColors.textSecondary : colors.textSecondary,
              }}
            >
              {t('sections.acceptedCount', { count: acceptAllResult })}
            </Text>
          )}
          <TouchableOpacity
            onPress={onRescan}
            disabled={isScanning}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isScanning ? (
              <ActivityIndicator
                size={13}
                color={isDark ? darkColors.textDisabled : colors.textDisabled}
              />
            ) : (
              <MaterialCommunityIcons
                name="reload"
                size={14}
                color={isDark ? darkColors.textDisabled : colors.textDisabled}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 4 : 2,
    borderRadius: 10,
    backgroundColor: colors.gray100,
  },
  searchContainerDark: {
    backgroundColor: darkColors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: colors.textOnDark,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  summaryTextDark: {
    color: darkColors.textPrimary,
  },
});
