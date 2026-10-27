import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { Row, RowDivider, SwitchRow } from '@/shared/ui';
import { Text } from 'react-native-paper';
import { colors, darkColors, typography } from '@/theme';

import { EXPERIMENTAL_FEATURES, featureRoute } from '../lib/experimentalFeatures';
import { useExperimentalExamples } from '../hooks/useExperimentalExamples';
import { useDebugStore } from '../stores/DebugStore';
import { settingsStyles } from './settingsStyles';

/** One switch and one link per experimental feature, each with a blurb on what it does. */
export function ExperimentalFeatures() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const features = useDebugStore((s) => s.experimentalFeatures);
  const setFeature = useDebugStore((s) => s.setExperimentalFeature);
  const { data: examples, isPending } = useExperimentalExamples();

  const linkColour = isDark ? darkColors.actionLink : colors.actionLink;

  return (
    <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
      {EXPERIMENTAL_FEATURES.map((feature, index) => {
        const route = featureRoute(feature, examples ?? undefined);
        return (
          <React.Fragment key={feature.key}>
            {index > 0 ? <RowDivider /> : null}
            <SwitchRow
              title={t(feature.titleKey)}
              description={t(feature.blurbKey)}
              value={features[feature.key] === true}
              onValueChange={(on) => void setFeature(feature.key, on)}
              testID={`experimental-switch-${feature.key}`}
            />
            {route ? (
              <Row
                testID={`experimental-link-${feature.key}`}
                behaviour="navigate"
                accessibilityLabel={`${t('experimental.open')}: ${t(feature.titleKey)}`}
                onPress={() => navigateTo(route)}
              >
                <Text style={[typography.bodyCompact, { color: linkColour }]}>
                  {t('experimental.open')}
                </Text>
              </Row>
            ) : isPending ? null : (
              <Row testID={`experimental-no-example-${feature.key}`}>
                <Text style={typography.bodyCompact}>{t('experimental.noExample')}</Text>
              </Row>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}
