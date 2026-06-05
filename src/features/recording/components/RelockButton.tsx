import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme';
import { styles } from '../RecordingScreen.styles';

export function RelockButton({
  isLocked,
  topInset,
  onLock,
}: {
  isLocked: boolean;
  topInset: number;
  onLock: () => void;
}) {
  const { t } = useTranslation();
  if (isLocked) return null;
  return (
    <TouchableOpacity
      testID="control-lock"
      style={[styles.relockButton, { top: topInset + spacing.sm }]}
      onPress={onLock}
      activeOpacity={0.7}
      accessibilityLabel={t('recording.controls.lock')}
    >
      <MaterialCommunityIcons name="lock-outline" size={20} color="rgba(255,255,255,0.9)" />
    </TouchableOpacity>
  );
}
