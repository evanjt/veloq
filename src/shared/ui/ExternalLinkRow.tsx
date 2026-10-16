import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { openExternal } from '@/shared/app/openExternal';
import { colors, darkColors, iconSize, typography } from '@/theme';
import { Row } from './Row';

interface ExternalLinkRowProps {
  url: string;
  /** What the row says, and what a screen reader announces as the link's name. */
  label: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Drawn in place of the icon and label, for a row that shows more than its name. */
  children?: React.ReactNode;
  testID?: string | undefined;
}

/** A list row that opens a web page through `openExternal`. */
export function ExternalLinkRow({ url, label, icon, children, testID }: ExternalLinkRowProps) {
  const { isDark } = useTheme();
  return (
    <Row
      testID={testID}
      behaviour="external"
      accessibilityLabel={label}
      onPress={() => {
        void openExternal(url);
      }}
    >
      {children ?? (
        <>
          {icon ? (
            <MaterialCommunityIcons name={icon} size={iconSize.md} color={colors.primary} />
          ) : null}
          <Text
            style={[styles.label, { color: isDark ? darkColors.textPrimary : colors.textPrimary }]}
          >
            {label}
          </Text>
        </>
      )}
    </Row>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.body,
    flex: 1,
  },
});
