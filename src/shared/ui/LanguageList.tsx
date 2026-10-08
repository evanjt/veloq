import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  getAvailableLanguages,
  getEnglishVariantValue,
  isEnglishVariant,
  isLanguageVariant,
} from '@/shared/app/LanguageStore';
import { brand, colors, darkColors, layout, spacing, typography } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

interface LanguageListProps {
  /** The stored language code. */
  language: string | null;
  onSelect: (value: string) => void;
}

/**
 * Every language the app speaks, one row each, with regional variants as chips. Dialect
 * variants carry a gold border, explained by a key below the last row so it never sits beside
 * a language it does not describe.
 */
export function LanguageList({ language, onSelect }: LanguageListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const languages = getAvailableLanguages().flatMap((group) => group.languages);
  const hasDialect = languages.some((lang) => lang.variants?.some((v) => v.isDialect));

  return (
    <View>
      {languages.map((lang, index) => {
        const isSelected = language === lang.value;
        const isVariantOfThisLanguage = isLanguageVariant(language, lang.value);
        const showCheck = isSelected || isVariantOfThisLanguage;

        return (
          <View
            key={lang.value}
            style={[
              styles.languageRow,
              index > 0 && styles.languageRowBorder,
              isDark && styles.languageRowDark,
            ]}
          >
            <Pressable
              onPress={() =>
                onSelect(lang.defaultVariant ?? lang.variants?.[0]?.value ?? lang.value)
              }
              style={pressable(styles.languageLabelContainer)}
              accessibilityRole="button"
              accessibilityLabel={lang.label}
              accessibilityState={{ selected: showCheck }}
              android_ripple={pressRipple}
            >
              <Text style={[styles.languageLabel, isDark && styles.textLight]}>{lang.label}</Text>
            </Pressable>
            {lang.variants && (
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
                        // A selected dialect keeps its gold border over the teal fill
                        variant.isDialect && isVariantSelected && styles.variantChipDialectSelected,
                        variant.isDialect &&
                          isVariantSelected &&
                          isDark &&
                          styles.variantChipDialectSelectedDark,
                      ])}
                      android_ripple={pressRipple}
                      onPress={() => onSelect(variant.value)}
                      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
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
            )}
            {showCheck && !lang.variants && (
              <MaterialCommunityIcons name="check" size={20} color={colors.primary} />
            )}
          </View>
        );
      })}
      {hasDialect && (
        <View
          style={[styles.dialectKey, isDark && styles.languageRowDark]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <View
            style={[
              styles.dialectKeySwatch,
              isDark && styles.variantChipDark,
              styles.variantChipDialect,
              isDark && styles.variantChipDialectDark,
            ]}
          />
          <Text style={[styles.dialectKeyText, isDark && styles.textSecondary]}>
            {t('settings.dialect')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  languageRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  languageRowDark: {
    borderTopColor: darkColors.border,
  },
  languageLabelContainer: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  languageLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  variantChips: {
    flexDirection: 'row',
    gap: spacing.xsPlus,
    marginLeft: 'auto',
  },
  variantChip: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colors.background,
    borderWidth: 1,
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
    borderColor: brand.gold,
  },
  variantChipDialectDark: {
    borderColor: brand.goldLight,
  },
  variantChipDialectSelected: {
    borderColor: brand.gold,
    borderWidth: 2,
  },
  variantChipDialectSelectedDark: {
    borderColor: brand.goldLight,
  },
  variantChipText: {
    ...typography.bodyCompact,
    fontWeight: '500',
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
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dialectKeySwatch: {
    width: spacing.lg,
    height: spacing.md,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: colors.background,
    borderWidth: 1,
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
