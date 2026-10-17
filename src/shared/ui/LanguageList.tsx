import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
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
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { Icon } from './Icon';
import { ToggleButton } from './Button';
import { PressTarget } from './PressTarget';

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
  const checkInk = isDark ? darkColors.actionLink : colors.actionLink;
  const languages = getAvailableLanguages().flatMap((group) => group.languages);
  const hasDialect = languages.some((lang) => lang.variants?.some((v) => v.isDialect));

  const followsSystem = language === SYSTEM_LANGUAGE;
  const phoneLanguage = languageLabel(resolveLanguageToLocale(SYSTEM_LANGUAGE)).label;

  return (
    <View>
      <View style={[styles.languageRow, isDark && styles.languageRowDark]}>
        <PressTarget
          testID="language-system"
          onPress={() => onSelect(SYSTEM_LANGUAGE)}
          style={styles.languageLabelContainer}
          hitSlop={slopToMinTapTarget(LANGUAGE_LABEL_HEIGHT)}
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.system')}, ${phoneLanguage}`}
          accessibilityState={{ selected: followsSystem }}
        >
          <Text style={[styles.languageLabel, isDark && styles.textLight]}>
            {t('settings.system')}
          </Text>
          <Text style={[styles.systemLanguage, isDark && styles.textSecondary]}>
            {phoneLanguage}
          </Text>
        </PressTarget>
        {Platform.OS === 'ios' && (
          <PressTarget
            testID="language-open-settings"
            onPress={openAppSettings}
            style={styles.settingsLink}
            hitSlop={slopToMinTapTarget(LANGUAGE_LABEL_HEIGHT)}
            accessibilityRole="link"
            accessibilityLabel={t('common.openSettings')}
          >
            <Text style={[styles.settingsLinkText, isDark && styles.settingsLinkTextDark]}>
              {t('common.openSettings')}
            </Text>
          </PressTarget>
        )}
        {followsSystem ? <Icon name="check" size={iconSize.md} color={checkInk} /> : null}
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
            <PressTarget
              onPress={() =>
                onSelect(lang.defaultVariant ?? lang.variants?.[0]?.value ?? lang.value)
              }
              style={styles.languageLabelContainer}
              hitSlop={slopToMinTapTarget(LANGUAGE_LABEL_HEIGHT)}
              accessibilityRole="button"
              accessibilityLabel={lang.label}
              accessibilityState={{ selected: showCheck }}
            >
              <Text style={[styles.languageLabel, isDark && styles.textLight]}>{lang.label}</Text>
            </PressTarget>
            {lang.variants ? (
              <View style={styles.variantChips}>
                {lang.variants.map((variant) => {
                  const isVariantSelected =
                    language === variant.value ||
                    (lang.value === 'en' &&
                      isEnglishVariant(language) &&
                      getEnglishVariantValue(language) === variant.value);
                  return (
                    <ToggleButton
                      key={variant.value}
                      label={variant.label}
                      selected={isVariantSelected}
                      outlined={variant.isDialect === true}
                      onPress={() => onSelect(variant.value)}
                      accessibilityLabel={
                        variant.isDialect
                          ? `${variant.label}, ${t('settings.dialect')}`
                          : variant.label
                      }
                    />
                  );
                })}
              </View>
            ) : null}
            {showCheck && !lang.variants ? (
              <Icon name="check" size={iconSize.md} color={checkInk} />
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
  // Adjacent small targets keep 8 pt between their drawn edges.
  variantChips: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginLeft: 'auto',
  },
  variantChipDialect: {
    borderColor: colors.controlBoundary,
  },
  variantChipDialectDark: {
    borderColor: darkColors.controlBoundary,
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
  // A small copy of an unselected dialect chip: its ground, its shape and its outline.
  dialectKeySwatch: {
    width: spacing.lg,
    height: spacing.md,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.fillNeutral,
    borderWidth: stroke.one,
  },
  dialectKeySwatchDark: {
    backgroundColor: darkColors.fillNeutral,
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
