/**
 * The sport filter on the routes and sections lists: one control naming the
 * sport the list is narrowed to, which opens the choice when pressed. Each
 * sport carries its count when one is given.
 */

import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Button, ToggleButton } from '@/shared/ui/Button';
import { colors, colorWithOpacity, darkColors, ink, layout, spacing, typography } from '@/theme';
import type { SportTypeOption } from './SportTypeSelector';

interface SportFilterMenuProps {
  options: SportTypeOption[];
  selectedType: string | undefined;
  /** The sport chosen, or undefined for all sports. */
  onSelect: (type: string | undefined) => void;
}

export function SportFilterMenu({ options, selectedType, onSelect }: SportFilterMenuProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const palette = isDark ? darkColors : colors;

  const name = (type: string) => t(`activityTypes.${type}`, type);
  const listed =
    selectedType === undefined || options.some((o) => o.type === selectedType)
      ? options
      : [{ type: selectedType }, ...options];
  const triggerLabel = selectedType === undefined ? t('routes.allSports') : name(selectedType);

  const choose = (type: string | undefined) => {
    setOpen(false);
    onSelect(type);
  };

  return (
    <View style={styles.row}>
      <Button
        testID="sport-filter-trigger"
        variant="secondary"
        size="sm"
        label={`${t('routes.sportFilterTitle')}: ${triggerLabel}`}
        onPress={() => setOpen(true)}
        icon={
          <MaterialCommunityIcons name="chevron-down" size={18} color={palette.textSecondary} />
        }
        style={styles.trigger}
      />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
            <Text style={[styles.title, { color: palette.textPrimary }]}>
              {t('routes.sportFilterTitle')}
            </Text>
            <ScrollView>
              <View style={styles.options}>
                <ToggleButton
                  testID="sport-filter-option-all"
                  size="md"
                  label={t('routes.allSports')}
                  selected={selectedType === undefined}
                  onPress={() => choose(undefined)}
                />
                {listed.map(({ type, count }) => (
                  <ToggleButton
                    key={type}
                    testID={`sport-filter-option-${type}`}
                    size="md"
                    label={count === undefined ? name(type) : `${name(type)} ${count}`}
                    selected={type === selectedType}
                    onPress={() => choose(type)}
                  />
                ))}
              </View>
            </ScrollView>
            <Button
              testID="sport-filter-close"
              variant="ghost"
              size="sm"
              label={t('common.close')}
              onPress={() => setOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  trigger: { flexDirection: 'row' },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colorWithOpacity(ink.black, 0.5),
  },
  sheet: {
    maxHeight: '80%',
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: typography.bodyBold,
  options: { gap: spacing.xs },
});
