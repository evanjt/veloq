import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  SYSTEM_LANGUAGE,
  getAvailableLanguages,
  getEnglishVariantValue,
  isEnglishVariant,
  isLanguageVariant,
  languageLabel,
  resolveLanguageToLocale,
} from '@/shared/app/LanguageStore';
import { openAppSettings } from '@/shared/app/permissions/openAppSettings';
import {
  colors,
  darkColors,
  iconSize,
  inputBoundary,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

interface LanguageListProps {
  /** The stored language code. */
  language: string | null;
  onSelect: (value: string) => void;
}

/**
 * Every language the app speaks, one row each, with regional variants as chips, after a row
 * that follows the phone's language. Dialect variants carry the neutral control outline, explained
 * by a key below the last row so it never sits beside a language it does not describe, and a
 * selected dialect is the same filled chip as any other selection. On iOS the system's
 * own per-app language is on the app's page in the Settings app, so the list links to it.
 */
export function LanguageList({ language, onSelect }: LanguageListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const languages = getAvailableLanguages().flatMap((group) => group.languages);
  const hasDialect = languages.some((lang) => lang.variants?.some((v) => v.isDialect));

  const followsSystem = language === SYSTEM_LANGUAGE;
  const phoneLanguage = languageLabel(resolveLanguageToLocale(SYSTEM_LANGUAGE)).label;

  return (
    <View>
      <View style={[styles.languageRow, isDark && styles.languageRowDark]}>
        <Pressable
          testID="language-system"
          onPress={() => onSelect(SYSTEM_LANGUAGE)}
          style={pressable(styles.languageLabelContainer)}
          hitSlop={slopToMinTapTarget(LANGUAGE_LABEL_HEIGHT)}
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.system')}, ${phoneLanguage}`}
          accessibilityState={{ selected: followsSystem }}
          android_ripple={pressRipple}
        >
          <Text style={[styles.languageLabel, isDark && styles.textLight]}>
            {t('settings.system')}
          </Text>
          <Text style={[styles.systemLanguage, isDark && styles.textSecondary]}>
            {phoneLanguage}
          </Text>
        </Pressable>
        {Platform.OS === 'ios' && (
          <Pressable
            testID="language-open-settings"
            onPress={openAppSettings}
            style={pressable(styles.settingsLink)}
            hitSlop={slopToMinTapTarget(LANGUAGE_LABEL_HEIGHT)}
            accessibilityRole="link"
            accessibilityLabel={t('common.openSettings')}
            android_ripple={pressRipple}
          >
            <Text style={[styles.settingsLinkText, isDark && styles.settingsLinkTextDark]}>
              {t('common.openSettings')}
            </Text>
          </Pressable>
        )}
        {followsSystem ? (
          <MaterialCommunityIcons name="check" size={iconSize.md} color={colors.primary} />
        ) : null}
      </View>
      {languages.map((lang) => {
        const isSelected = language === lang.value;
        const isVariantOfThisLanguage = isLanguageVariant(language, lang.value);
        const showCheck = isSelected || isVariantOfThisLanguage;

        return (
          <View
            key={lang.value}
            style={[styles.languageRow, styles.languageRowBorder, isDark && styles.languageRowDark]}
          >
            <Pressable
              onPress={() =>
                onSelect(lang.defaultVariant ?? lang.variants?.[0]?.value ?? lang.value)
              }
              style={pressable(styles.languageLabelContainer)}
              hitSlop={slopToMinTapTarget(LANGUAGE_LABEL_HEIGHT)}
              accessibilityRole="button"
              accessibilityLabel={lang.label}
              accessibilityState={{ selected: showCheck }}
              android_ripple={pressRipple}
            >
              <Text style={[styles.languageLabel, isDark && styles.textLight]}>{lang.label}</Text>
            </Pressable>
            {lang.variants ? (
              <View style={styles.variantChips}>
                {lang.variants.map((variant) => {
                  const isVariantSelected =
                    language === variant.value ||
                    (lang.value === 'en' &&
                      isEnglishVariant(language) &&
                      getEnglishVariantValue(language) === variant.value);
                  return (
                    <Pressable
                      key={variant.value}
                      style={pressable([
                        styles.variantChip,
                        isDark && styles.variantChipDark,
                        variant.isDialect && !isVariantSelected && styles.variantChipDialect,
                        variant.isDialect &&
                          !isVariantSelected &&
                          isDark &&
                          styles.variantChipDialectDark,
                        isVariantSelected && styles.variantChipSelected,
                      ])}
                      android_ripple={pressRipple}
                      onPress={() => onSelect(variant.value)}
                      hitSlop={VARIANT_CHIP_SLOP}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isVariantSelected }}
                      accessibilityLabel={
                        variant.isDialect
                          ? `${variant.label}, ${t('settings.dialect')}`
                          : variant.label
                      }
                    >
                      <Text
                        style={[
                          styles.variantChipText,
                          isVariantSelected && styles.variantChipTextSelected,
                          isDark && !isVariantSelected && styles.textSecondary,
                        ]}
                      >
                        {variant.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {showCheck && !lang.variants ? (
              <MaterialCommunityIcons name="check" size={iconSize.md} color={colors.primary} />
            ) : null}
          </View>
        );
      })}
      {hasDialect ? (
        <View
          style={[styles.dialectKey, isDark && styles.languageRowDark]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <View
            testID="language-dialect-key-swatch"
            style={[
              styles.dialectKeySwatch,
              isDark && styles.dialectKeySwatchDark,
              styles.variantChipDialect,
              isDark && styles.variantChipDialectDark,
            ]}
          />
          <Text style={[styles.dialectKeyText, isDark && styles.textSecondary]}>
            {t('settings.dialect')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const VARIANT_CHIP_GAP = spacing.xsPlus;
const VARIANT_CHIP_HEIGHT = typography.bodyCompact.lineHeight + 2 * (spacing.xs + stroke.one);
// Side by side, each chip reaches half the gap so the two targets meet without
// overlapping.
const VARIANT_CHIP_SLOP = {
  ...slopToMinTapTarget(VARIANT_CHIP_HEIGHT),
  left: VARIANT_CHIP_GAP / 2,
  right: VARIANT_CHIP_GAP / 2,
};

// The label's line inside its padding. The row's own padding holds the slop
// that lifts it to the tap target, so neighbouring rows are not reached.
const LANGUAGE_LABEL_HEIGHT = typography.body.lineHeight + 2 * spacing.xs;

const styles = StyleSheet.create({
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  languageRowBorder: {
    borderTopWidth: stroke.one,
    borderTopColor: colors.border,
  },
  languageRowDark: {
    borderTopColor: darkColors.border,
  },
  languageLabelContainer: {
    flex: 1,
    paddingVertical: spacing.xs,
    minHeight: LANGUAGE_LABEL_HEIGHT,
  },
  languageLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  systemLanguage: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  settingsLink: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  settingsLinkText: {
    ...typography.bodyCompact,
    color: colors.actionLink,
  },
  settingsLinkTextDark: {
    color: darkColors.actionLink,
  },
  variantChips: {
    flexDirection: 'row',
    gap: VARIANT_CHIP_GAP,
    marginLeft: 'auto',
  },
  variantChip: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colors.background,
    borderWidth: stroke.one,
    borderColor: colors.border,
  },
  variantChipDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  variantChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  variantChipDialect: {
    borderColor: inputBoundary.light,
  },
  variantChipDialectDark: {
    borderColor: inputBoundary.dark,
  },
  variantChipText: {
    ...typography.bodyCompactBold,
    color: colors.textSecondary,
  },
  variantChipTextSelected: {
    color: colors.textOnPrimary,
  },
  dialectKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: stroke.one,
    borderTopColor: colors.border,
  },
  dialectKeySwatch: {
    width: spacing.lg,
    height: spacing.md,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: colors.background,
    borderWidth: stroke.one,
  },
  dialectKeySwatchDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  dialectKeyText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
