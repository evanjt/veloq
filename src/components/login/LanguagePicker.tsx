import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  useLanguageStore,
  getAvailableLanguages,
  isLanguageVariant,
  isEnglishVariant,
  getEnglishVariantValue,
} from '@/providers';
import { colors, darkColors, spacing, brand } from '@/theme';
import { useTheme } from '@/hooks';

export const LanguagePicker = React.memo(function LanguagePicker() {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const [showLanguages, setShowLanguages] = React.useState(false);
  const availableLanguages = getAvailableLanguages();

  const { currentLanguageLabel, isDialectSelected } = React.useMemo(() => {
    for (const group of availableLanguages) {
      for (const lang of group.languages) {
        if (language === lang.value) {
          return { currentLanguageLabel: lang.label, isDialectSelected: false };
        }
        if (lang.variants) {
          const variant = lang.variants.find((v) => v.value === language);
          if (variant) {
            return {
              currentLanguageLabel: `${lang.label} (${variant.label})`,
              isDialectSelected: variant.isDialect ?? false,
            };
          }
        }
        if (isLanguageVariant(language, lang.value)) {
          return { currentLanguageLabel: lang.label, isDialectSelected: false };
        }
      }
    }
    return { currentLanguageLabel: 'English', isDialectSelected: false };
  }, [language, availableLanguages]);

  const handleLanguageChange = async (value: string) => {
    await setLanguage(value);
    setShowLanguages(false);
  };

  return (
    <>
      {/* Language Selector - top right */}
      <View style={styles.languagePickerContainer}>
        <TouchableOpacity
          testID="login-language-button"
          style={[
            styles.languageButton,
            isDark && styles.languageButtonDark,
            isDialectSelected && styles.languageButtonDialect,
            isDialectSelected && isDark && styles.languageButtonDialectDark,
          ]}
          onPress={() => setShowLanguages(!showLanguages)}
        >
          <MaterialCommunityIcons
            name="translate"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.languageButtonText, isDark && styles.textDark]}>
            {currentLanguageLabel}
          </Text>
          <MaterialCommunityIcons
            name={showLanguages ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Language Dropdown */}
      {showLanguages && (
        <View style={[styles.languageDropdown, isDark && styles.languageDropdownDark]}>
          {/* Dialect legend - fixed at top right, styled as chip */}
          <View style={[styles.dialectLegendHeader, isDark && styles.dialectLegendHeaderDark]}>
            <View
              style={[
                styles.variantChip,
                isDark && styles.variantChipDark,
                styles.variantChipDialect,
                isDark && styles.variantChipDialectDark,
                styles.dialectLegendChip,
              ]}
            >
              <Text style={[styles.variantChipText, isDark && styles.textMuted]}>
                {t('settings.dialect')}
              </Text>
            </View>
          </View>
          {availableLanguages.flatMap((group, groupIndex) =>
            group.languages.map((lang, langIndex) => {
              const index = groupIndex * 100 + langIndex;
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
                  <TouchableOpacity
                    onPress={() => {
                      const valueToUse =
                        lang.defaultVariant ?? lang.variants?.[0]?.value ?? lang.value;
                      handleLanguageChange(valueToUse);
                    }}
                    style={styles.languageLabelContainer}
                  >
                    <Text style={[styles.languageLabel, isDark && styles.textLight]}>
                      {lang.label}
                    </Text>
                  </TouchableOpacity>
                  {lang.variants && (
                    <View style={styles.variantChips}>
                      {lang.variants.map((variant) => {
                        const isVariantSelected =
                          language === variant.value ||
                          (lang.value === 'en' &&
                            isEnglishVariant(language) &&
                            getEnglishVariantValue(language) === variant.value);
                        return (
                          <TouchableOpacity
                            key={variant.value}
                            style={[
                              styles.variantChip,
                              isDark && styles.variantChipDark,
                              variant.isDialect && !isVariantSelected && styles.variantChipDialect,
                              variant.isDialect &&
                                !isVariantSelected &&
                                isDark &&
                                styles.variantChipDialectDark,
                              isVariantSelected && styles.variantChipSelected,
                              isVariantSelected && isDark && styles.variantChipSelectedDark,
                              variant.isDialect &&
                                isVariantSelected &&
                                styles.variantChipDialectSelected,
                              variant.isDialect &&
                                isVariantSelected &&
                                isDark &&
                                styles.variantChipDialectSelectedDark,
                            ]}
                            onPress={() => handleLanguageChange(variant.value)}
                          >
                            <Text
                              style={[
                                styles.variantChipText,
                                isVariantSelected && styles.variantChipTextSelected,
                                isDark && !isVariantSelected && styles.textMuted,
                              ]}
                            >
                              {variant.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  {showCheck && !lang.variants && (
                    <MaterialCommunityIcons name="check" size={20} color={colors.primary} />
                  )}
                </View>
              );
            })
          )}
        </View>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  languagePickerContainer: {
    alignItems: 'flex-end',
    marginBottom: spacing.md,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageButtonDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  languageButtonDialect: {
    borderColor: brand.gold,
    borderWidth: 2,
  },
  languageButtonDialectDark: {
    borderColor: brand.goldLight,
  },
  languageButtonText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  languageDropdown: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageDropdownDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
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
    fontSize: 16,
    color: colors.textPrimary,
  },
  variantChips: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 'auto',
  },
  variantChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
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
  variantChipSelectedDark: {
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
    borderWidth: 2,
  },
  variantChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  variantChipTextSelected: {
    color: colors.textOnDark,
  },
  dialectLegendHeader: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.md - 1,
    zIndex: 1,
  },
  dialectLegendHeaderDark: {},
  dialectLegendChip: {},
  textLight: {
    color: darkColors.textPrimary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
